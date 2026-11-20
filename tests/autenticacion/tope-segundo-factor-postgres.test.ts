import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { repositorioPg } from "../../src/server/autenticacion/repositorio.ts";
import { iniciarConContrasena, leerPaso } from "../../src/server/autenticacion/servicio.ts";
import { hashDeToken, hashearContrasena } from "../../src/server/session/hash.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

/**
 * 0040_tope_segundo_factor en un Postgres desechable: la entrada nueva cierra las
 * abiertas, fallos_de_segundo_factor cuenta por persona y por ventana (todas sus
 * entradas, cualquier puerta) y, con diez, la contraseña correcta ya no abre entrada
 * a quien tiene app autenticadora.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLAVE = "clave-segura-12";
const SIN_PISO = { esperar: async () => {} };
const RECHAZO = { tipo: "rechazo", codigo: "credenciales_invalidas" };

type Cliente = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

describe("tope del segundo factor por persona en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("cierra las entradas anteriores, cuenta los fallos de la persona en quince minutos y bloquea la entrada nueva", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = (await import("pg")) as unknown as { Client: new (opts: { connectionString: string }) => Cliente };
      const duena = new Client({ connectionString: urlDuena });
      await duena.connect();
      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      try {
        const hash = await hashearContrasena(CLAVE);
        const ana = randomUUID();
        const beto = randomUUID();
        for (const [id, nombre, correo] of [
          [ana, "Ana con app", "ana@empresa-a.mx"],
          [beto, "Beto sin app", "beto@empresa-b.mx"],
        ] as const) {
          await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [id, nombre, correo, hash]);
        }
        await duena.query(
          `insert into auth_totp (id, user_id, secreto_cifrado, creado_en, confirmado_en) values ($1, $2, $3, now(), now())`,
          [randomUUID(), ana, `v1.${"a".repeat(16)}.${"b".repeat(32)}.${"c".repeat(22)}`],
        );
        const repo = repositorioPg();

        // La entrada nueva deja sin efecto la anterior.
        const primera = await entrar("ana@empresa-a.mx");
        const segunda = await entrar("ana@empresa-a.mx");
        await assert.rejects(leerPaso(primera), (e: unknown) => e instanceof ErrorDeDominio && e.codigo === "entrada_vencida");
        assert.equal((await leerPaso(segunda)).paso, "verificar");
        const abiertas = await duena.query("select token_hash from auth_entradas where user_id = $1 and consumida_en is null", [ana]);
        assert.deepEqual(abiertas.rows.map((f) => f.token_hash), [hashDeToken(segunda)]);
        const vieja = await entradaDe(duena, primera);
        assert.equal(await repo.apartarIntentoDeEntrada(vieja, ana), null, "la vieja ya no aparta intentos");

        // Fallos repartidos: 16 minutos atrás no cuentan; cuentan los de cada entrada de la persona.
        const actual = await entradaDe(duena, segunda);
        const haceDieciseis = new Date(Date.now() - 16 * 60_000);
        for (let i = 0; i < 5; i += 1) await repo.registrarFalloDeEntrada({ entradaId: vieja, userId: ana, intentos: 1, ahora: haceDieciseis });
        for (let i = 0; i < 6; i += 1) await repo.registrarFalloDeEntrada({ entradaId: vieja, userId: ana, intentos: 1, ahora: new Date() });
        for (let i = 0; i < 3; i += 1) await repo.registrarFalloDeEntrada({ entradaId: actual, userId: ana, intentos: 1, ahora: new Date() });
        const desde = new Date(Date.now() - 15 * 60_000);
        assert.equal(await repo.contarFallosSegundoFactor(ana, desde), 9);
        assert.equal(await repo.contarFallosSegundoFactor(beto, desde), 0, "los de Ana no son de Beto");
        assert.equal((await entrar("ana@empresa-a.mx")).length > 0, true, "con nueve todavía entra");

        const tercera = await entradaDe(duena, await entrar("ana@empresa-a.mx"));
        await repo.registrarFalloDeEntrada({ entradaId: tercera, userId: ana, intentos: 1, ahora: new Date() });
        assert.equal(await repo.contarFallosSegundoFactor(ana, desde), 10);
        const entradas = Number((await duena.query("select count(*)::int as n from auth_entradas where user_id = $1", [ana])).rows[0]?.n);
        assert.deepEqual(await iniciarConContrasena({ correo: "ana@empresa-a.mx", contrasena: CLAVE }, SIN_PISO), RECHAZO);
        assert.deepEqual(
          await iniciarConContrasena({ correo: "ana@empresa-a.mx", contrasena: CLAVE }, { ...SIN_PISO, superficie: "sofipo" }),
          RECHAZO,
          "la puerta de Operación también",
        );
        assert.equal(
          Number((await duena.query("select count(*)::int as n from auth_entradas where user_id = $1", [ana])).rows[0]?.n),
          entradas,
          "en el tope no se abre entrada",
        );
        assert.equal(await repo.contarFallosContrasena(ana, desde), 0, "ni se anota como contraseña fallida");

        // Sin app autenticadora, diez fallos no bloquean.
        const deBeto = await entradaDe(duena, await entrar("beto@empresa-b.mx"));
        for (let i = 0; i < 10; i += 1) await repo.registrarFalloDeEntrada({ entradaId: deBeto, userId: beto, intentos: 1, ahora: new Date() });
        assert.equal(await repo.contarFallosSegundoFactor(beto, desde), 10);
        assert.ok(await entrar("beto@empresa-b.mx"));

        // La función es definer con el search_path de 0029, solo para plataforma_cliente, y usa su índice.
        const funcion = (
          await duena.query(
            `select p.prosecdef as definer, p.proconfig as config,
                    has_function_privilege('plataforma_cliente', p.oid, 'execute') as cliente,
                    has_function_privilege('plataforma_sofipo', p.oid, 'execute') as sofipo
             from pg_proc p where p.proname = 'fallos_de_segundo_factor'`,
          )
        ).rows[0];
        assert.deepEqual(funcion, { definer: true, config: ["search_path=public, pg_temp"], cliente: true, sofipo: false });
        await duena.query("begin");
        await duena.query("set local enable_seqscan = off");
        const plan = (
          await duena.query(
            `explain select count(*) from audit_log
             where accion = 'segundo_factor_fallido' and actor_id = '${ana}' and ocurrido_en >= now() - interval '15 minutes'`,
          )
        ).rows
          .map((fila) => String(fila["QUERY PLAN"]))
          .join("\n");
        await duena.query("rollback");
        assert.match(plan, /audit_log_segundo_factor_fallido_idx/);
      } finally {
        await duena.end();
        await cerrarConexion();
      }
    });
  });
});

async function entrar(correo: string): Promise<string> {
  const resultado = await iniciarConContrasena({ correo, contrasena: CLAVE }, SIN_PISO);
  if (resultado.tipo !== "entrada") throw new Error(`no abrió entrada: ${resultado.codigo}`);
  return resultado.cookie.valor;
}

async function entradaDe(duena: Cliente, token: string): Promise<string> {
  return String((await duena.query("select id from auth_entradas where token_hash = $1", [hashDeToken(token)])).rows[0]?.id);
}
