import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import {
  iniciarConContrasena,
  PISO_RECHAZO_MS,
  TOPE_CONTRASENA,
  type ResultadoContrasena,
} from "../../src/server/autenticacion/servicio.ts";
import { hashearContrasena } from "../../src/server/session/hash.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

/**
 * El tope de contraseña por persona (TOPE_CONTRASENA fallos en 15 minutos) no revela qué correos tienen
 * cuenta: la cuenta en el tope, la contraseña mala y el correo inexistente dan
 * el mismo rechazo y tardan lo mismo, con bcrypt y la bitácora reales. El tope
 * sigue bloqueando y el intento en el tope no se anota.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLAVE = "clave-segura-12";
const MALA = "otra-clave-99";
const RECHAZO: ResultadoContrasena = { tipo: "rechazo", codigo: "credenciales_invalidas" };
/** Holgura sobre el piso: el temporizador y la base local no son exactos. */
const TOLERANCIA_MS = 250;
const DIFERENCIA_MAXIMA_MS = 100;

type Cliente = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

describe("el tope de contraseña en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("la cuenta en el tope, la contraseña mala y el correo inexistente responden igual y al mismo tiempo", async (t) => {
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
        for (const [id, nombre] of [[ana, "ana"], [beto, "beto"]]) {
          await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [
            id,
            nombre,
            `${nombre}@empresa.mx`,
            hash,
          ]);
        }
        const t0 = Date.now();
        const en = (minutos: number) => ({ ahora: () => new Date(t0 + minutos * 60_000) });
        const fallos = async (userId: string | null) =>
          Number(
            (
              await duena.query(
                "select count(*)::int as n from audit_log where accion = 'entrada_fallida' and actor_id is not distinct from $1",
                [userId],
              )
            ).rows[0]?.n,
          );

        // 1. Ana llega al tope de contraseñas malas.
        const tope = await Promise.all(
          Array.from({ length: TOPE_CONTRASENA }, () => iniciarConContrasena({ correo: "ana@empresa.mx", contrasena: MALA }, en(0))),
        );
        for (const resultado of tope) assert.deepEqual(resultado, RECHAZO);
        assert.equal(await fallos(ana), TOPE_CONTRASENA);

        // 2. Mismo resultado en los tres casos, incluida la contraseña correcta de la cuenta en el tope.
        const sinCuentaAntes = await fallos(null);
        const [topeMala, topeCorrecta, mala, inexistente] = await Promise.all([
          iniciarConContrasena({ correo: "ana@empresa.mx", contrasena: MALA }, en(1)),
          iniciarConContrasena({ correo: "ana@empresa.mx", contrasena: CLAVE }, en(1)),
          iniciarConContrasena({ correo: "beto@empresa.mx", contrasena: MALA }, en(1)),
          iniciarConContrasena({ correo: "nadie@empresa.mx", contrasena: MALA }, en(1)),
        ]);
        for (const resultado of [topeMala, topeCorrecta, mala, inexistente]) assert.deepEqual(resultado, RECHAZO);
        // El intento en el tope no se anota; la contraseña mala y el correo sin cuenta sí.
        assert.equal(await fallos(ana), TOPE_CONTRASENA);
        assert.equal(await fallos(beto), 1);
        assert.equal(await fallos(null), sinCuentaAntes + 1);
        const entradas = await duena.query("select count(*)::int as n from auth_entradas where user_id = $1", [ana]);
        assert.equal(entradas.rows[0]?.n, 0);

        // 3. Tiempo de punta a punta: tres rondas, en serie para no competir por bcrypt.
        const casos = {
          tope: "ana@empresa.mx",
          mala: "beto@empresa.mx",
          inexistente: "nadie@empresa.mx",
        } as const;
        const tiempos: Record<keyof typeof casos, number[]> = { tope: [], mala: [], inexistente: [] };
        for (let ronda = 0; ronda < 3; ronda += 1) {
          for (const [caso, correo] of Object.entries(casos) as [keyof typeof casos, string][]) {
            const inicio = performance.now();
            assert.deepEqual(await iniciarConContrasena({ correo, contrasena: MALA }, en(2)), RECHAZO);
            tiempos[caso].push(performance.now() - inicio);
          }
        }
        for (const [caso, lista] of Object.entries(tiempos)) {
          for (const ms of lista) {
            assert.ok(
              ms >= PISO_RECHAZO_MS - 2 && ms <= PISO_RECHAZO_MS + TOLERANCIA_MS,
              `${caso} tardó ${ms.toFixed(1)} ms; se esperaba entre ${PISO_RECHAZO_MS} y ${PISO_RECHAZO_MS + TOLERANCIA_MS}`,
            );
          }
        }
        for (const [caso, lista] of Object.entries(tiempos)) t.diagnostic(`${caso}: ${lista.map((ms) => ms.toFixed(1)).join(" ")} ms`);
        const mediana = (lista: number[]) => [...lista].sort((a, b) => a - b)[1]!;
        const medianas = Object.values(tiempos).map(mediana);
        assert.ok(
          Math.max(...medianas) - Math.min(...medianas) <= DIFERENCIA_MAXIMA_MS,
          `medianas ${medianas.map((ms) => ms.toFixed(1)).join(", ")} ms`,
        );
        assert.equal(await fallos(ana), TOPE_CONTRASENA);

        // 4. El tope sigue: dentro de la ventana la contraseña correcta no entra; pasada la ventana, sí.
        assert.deepEqual(await iniciarConContrasena({ correo: "ana@empresa.mx", contrasena: CLAVE }, en(14)), RECHAZO);
        const despues = await iniciarConContrasena({ correo: "ana@empresa.mx", contrasena: CLAVE }, en(16));
        assert.equal(despues.tipo, "entrada");
      } finally {
        await cerrarConexion();
        await duena.end();
      }
    });
  });
});
