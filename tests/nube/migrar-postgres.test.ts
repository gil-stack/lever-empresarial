import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import pg from "pg";

import { aplicar, archivos } from "../../scripts/migrar.mjs";
import { conBaseDesechable, ejecutar } from "../aislamiento/postgres.ts";

/**
 * El migrador nuevo (scripts/migrar.mjs, el que corre al desplegar) y el viejo (db/migrate.sh, con el que se migró
 * producción a mano) leen y escriben la misma tabla schema_migrations: sobre una base migrada por uno, el otro no
 * reaplica nada.
 */

const RAIZ = join(import.meta.dirname, "../..");
const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

/** db/migrate.sh de verdad. Igual que en tests/proveedores/migracion-pagos-postgres.test.ts: un psql de captura saca
 * el SQL que el script arma (así su validación de «plataforma» nunca apunta a una base real) y el psql de la prueba
 * lo corre contra la base desechable. Devuelve lo que imprimió. */
function migrarConElViejo(url: string): string {
  const captura = mkdtempSync(join(tmpdir(), "runner-migrar-"));
  try {
    const shim = join(captura, "psql");
    writeFileSync(shim, '#!/bin/sh\nfor arg do ultimo="$arg"; done\ncat "$ultimo"\n');
    chmodSync(shim, 0o755);
    const destinoDeCaptura = new URL("postgres://captura.invalid/plataforma");
    const generado = spawnSync("bash", [join(RAIZ, "db/migrate.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${captura}:${process.env.PATH}`, DATABASE_URL_UNPOOLED: destinoDeCaptura.href },
    });
    assert.equal(generado.status, 0, generado.stderr);
    const sql = generado.stdout
      .slice(0, generado.stdout.lastIndexOf("COMMIT;") + "COMMIT;".length)
      .replaceAll(`${RAIZ}/db/migrations/`, "db/migrations/");
    const destino = new URL(url);
    const env = { ...process.env, PGPASSWORD: decodeURIComponent(destino.password) };
    delete env.DATABASE_URL;
    delete env.DATABASE_URL_UNPOOLED;
    destino.password = "";
    const resultado = spawnSync("psql", [destino.toString(), "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
      encoding: "utf8", env, cwd: RAIZ, input: sql, timeout: 180_000,
    });
    assert.equal(resultado.status, 0, resultado.stderr.replaceAll(url, "***"));
    return resultado.stdout;
  } finally {
    rmSync(captura, { recursive: true, force: true });
  }
}

async function conCliente<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  c.on("error", () => {});
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function anotadas(url: string): Promise<{ version: string; applied_at: string }[]> {
  return conCliente(url, async (c) =>
    (await c.query("select version, applied_at::text from schema_migrations order by version")).rows);
}

const versiones = archivos().map((archivo) => archivo.slice(0, -4));

describe("migrar al desplegar: compatible con db/migrate.sh", { skip: urlAdmin.length === 0 }, () => {
  it("sobre una base migrada con el script viejo, el nuevo no reaplica nada ni toca lo anotado", async () => {
    await conBaseDesechable(urlAdmin, async (url) => {
      assert.match(migrarConElViejo(url), /Aplicando 0001_/);
      // Como en producción: una versión anotada que no tiene archivo en esta rama (la 0040 se aplicó desde el
      // PR #83, que sigue abierto). No estorba.
      ejecutar(url, "insert into schema_migrations (version) values ('9999_aplicada_desde_otra_rama')");
      const antes = await anotadas(url);
      assert.deepEqual(antes.map((fila) => fila.version), [...versiones, "9999_aplicada_desde_otra_rama"]);

      const avisos: string[] = [];
      const aplicadas = await conCliente(url, (c) => aplicar(c, { avisar: (texto: string) => avisos.push(texto) }));
      assert.deepEqual(aplicadas, []);
      assert.deepEqual(avisos, []);
      assert.deepEqual(await anotadas(url), antes);
    });
  });

  it("desde cero aplica todo una sola vez, y después el script viejo tampoco reaplica nada", async () => {
    await conBaseDesechable(urlAdmin, async (url) => {
      const primera = await conCliente(url, (c) => aplicar(c));
      assert.deepEqual(primera, versiones);
      assert.deepEqual((await anotadas(url)).map((fila) => fila.version), versiones);

      assert.deepEqual(await conCliente(url, (c) => aplicar(c)), []);
      assert.doesNotMatch(migrarConElViejo(url), /Aplicando/);
      assert.deepEqual((await anotadas(url)).map((fila) => fila.version), versiones);
    });
  });

  it("si una migración falla, no queda nada a medias: ni tablas ni anotaciones", async () => {
    await conBaseDesechable(urlAdmin, async (url) => {
      const directorio = mkdtempSync(join(tmpdir(), "migraciones-"));
      try {
        writeFileSync(join(directorio, "0001_buena.sql"), "create table prueba_buena (id int);");
        writeFileSync(join(directorio, "0002_mala.sql"), "create table prueba_mala (id int); select 1/0;");
        await assert.rejects(conCliente(url, (c) => aplicar(c, { directorio })), /division by zero/);
        const quedo = await conCliente(url, async (c) =>
          (await c.query("select to_regclass('public.prueba_buena') as buena, to_regclass('public.schema_migrations') as control")).rows[0]);
        assert.deepEqual(quedo, { buena: null, control: null });
      } finally {
        rmSync(directorio, { recursive: true, force: true });
      }
    });
  });
});
