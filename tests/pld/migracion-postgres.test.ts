import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable } from "../aislamiento/postgres.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
const LA_0030 = "0030_pld_alertas_reportes";

/**
 * La 0030 sobre una base que ya tiene lo anterior, con la misma transacción que arma db/migrate.sh (lock_timeout de
 * 15 s, BEGIN, candado de migración, schema_migrations, la migración y COMMIT). Corre aparte (psql asíncrono) para
 * que la prueba pueda medir, mientras tanto, lo que espera una escritura normal.
 */
function migrar0030(urlDuena: string): Promise<{ codigo: number; error: string }> {
  const carpeta = mkdtempSync(join(tmpdir(), "migracion-0030-"));
  const corredor = join(carpeta, "corredor.sql");
  writeFileSync(corredor, [
    "SET lock_timeout = '15s';",
    "SET client_min_messages TO warning;",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(814271) AS migracion_en_curso \\gset",
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());",
    `\\i ${join(MIGRACIONES, `${LA_0030}.sql`)}`,
    `INSERT INTO schema_migrations (version) VALUES ('${LA_0030}');`,
    "COMMIT;",
  ].join("\n"));
  const url = new URL(urlDuena);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  url.password = "";
  return new Promise((listo) => {
    execFile("psql", [url.toString(), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", corredor], { env, timeout: 120_000 }, (error, _salida, errores) => {
      listo({ codigo: error ? Number((error as { code?: number }).code ?? 1) : 0, error: String(errores) });
    });
  });
}

/** Espera a que alguien quede esperando un candado (la migración detrás de la transacción larga). */
async function hayEspera(c: pg.Client): Promise<boolean> {
  for (let i = 0; i < 200; i++) {
    if (Number((await c.query("select count(*)::int as n from pg_locks where not granted")).rows[0].n) > 0) return true;
    await new Promise((listo) => setTimeout(listo, 25));
  }
  return false;
}

describe("0030 sobre una base en uso: lock_timeout de 2 s desde su primera sentencia", { skip: urlAdmin.length === 0 }, () => {
  for (const caso of [
    {
      nombre: "una lectura larga de audit_log",
      bloquea: (c: pg.Client) => c.query("select count(*) from audit_log"),
      escribe: (c: pg.Client, empresa: string, operador: string) => c.query(
        "insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador) values ($1, $2, 'sistema', 'sistema', 'alta_empresa', 'companies', $2)",
        [operador, empresa],
      ),
    },
    {
      nombre: "una escritura larga abierta en companies",
      bloquea: (c: pg.Client, empresa: string) => c.query("update companies set razon_social = razon_social where id = $1", [empresa]),
      escribe: (c: pg.Client, _empresa: string, _operador: string, otra: string) => c.query("update companies set razon_social = razon_social where id = $1", [otra]),
    },
  ]) {
    it(`${caso.nombre}: una escritura normal espera a lo más unos 2 s, la 0030 se deshace completa y se reintenta`, async (t) => {
      exigirBaseDesechable();
      await conBaseDesechable(urlAdmin, async (urlDuena) => {
        for (const archivo of readdirSync(MIGRACIONES).sort()) {
          if (archivo.endsWith(".sql") && !archivo.startsWith("0030_")) aplicarArchivo(urlDuena, join(MIGRACIONES, archivo));
        }
        const conectar = async () => {
          const c = new pg.Client({ connectionString: urlDuena });
          await c.connect();
          return c;
        };
        const dueno = await conectar();
        const larga = await conectar();
        const normal = await conectar();
        try {
          const operador = String((await dueno.query("select id from operators order by alta_en limit 1")).rows[0].id);
          const empresas: string[] = [];
          for (const [rfc, razon] of [["UNO150301AB1", "Uno Comercial SA de CV"], ["DOS150301AB2", "Dos Comercial SA de CV"]]) {
            const id = String((await dueno.query("select gen_random_uuid() as id")).rows[0].id);
            await dueno.query("begin");
            await dueno.query(
              `insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
               values ($1, $2, $3, '06600', '601', 'G03', $4, 'activa', false)`,
              [id, rfc, razon, operador],
            );
            await dueno.query(
              "insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador) values ($1, $2, 'sistema', 'sistema', 'alta_empresa', 'companies', $2)",
              [operador, id],
            );
            await dueno.query("commit");
            empresas.push(id);
          }

          // La transacción larga queda abierta; la migración llega, espera su candado y, detrás de ella, una escritura normal.
          await larga.query("begin");
          await caso.bloquea(larga, empresas[0]!);
          const migracion = migrar0030(urlDuena);
          assert.equal(await hayEspera(dueno), true, "la migración espera el candado que tiene la transacción larga");
          const inicio = Date.now();
          await caso.escribe(normal, empresas[0]!, operador, empresas[1]!);
          const espera = Date.now() - inicio;
          const fallida = await migracion;
          t.diagnostic(`la escritura normal esperó ${espera} ms; la migración: ${fallida.error.trim().split("\n")[0]}`);
          assert.ok(espera <= 3000, `la escritura normal esperó ${espera} ms`);
          assert.notEqual(fallida.codigo, 0);
          assert.match(fallida.error, /lock timeout/);
          // Nada de la 0030 quedó: ni sus tablas, ni su función de la marca de demostración, ni su renglón de control.
          const quedo = (await dueno.query(
            `select to_regclass('public.pld_operaciones') is not null as tablas, to_regclass('public.schema_migrations') is not null as control,
                    (select prosrc like '%empresa_real_no_pasa_a_demostracion%' from pg_proc where proname = 'companies_demostracion_no_dinero') as funcion`,
          )).rows[0];
          assert.deepEqual(quedo, { tablas: false, control: false, funcion: false });

          // Terminada la transacción larga, se reintenta igual y entra completa.
          await larga.query("commit");
          const reintento = await migrar0030(urlDuena);
          assert.equal(reintento.codigo, 0, reintento.error);
          assert.deepEqual((await dueno.query(`select version from schema_migrations`)).rows, [{ version: LA_0030 }]);
          assert.equal((await dueno.query("select to_regclass('public.pld_operaciones') is not null as hay")).rows[0].hay, true);
        } finally {
          await larga.query("rollback").catch(() => undefined);
          await Promise.all([dueno.end(), larga.end(), normal.end()]);
        }
      });
    });
  }
});

