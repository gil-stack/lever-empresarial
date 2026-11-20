import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { repositorioPg } from "../../src/server/autenticacion/repositorio.ts";
import { iniciarConContrasena } from "../../src/server/autenticacion/servicio.ts";
import { hashearContrasena } from "../../src/server/session/hash.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

/**
 * 0045_intentos_por_cuenta_e_ip en un Postgres desechable: la aplicación no lee ni escribe la tabla directo, solo con
 * las dos funciones definer; la pareja cuenta sus fallos desde el último acierto; la IP cuenta correos distintos en
 * quince minutos y sabe si la cuenta ya entró desde ahí; y la tabla no guarda correo ni IP en claro.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLAVE = "clave-segura-12";
const MALA = "otra-clave-99";
const SIN_PISO = { esperar: async () => {} };
const RECHAZO = { tipo: "rechazo", codigo: "credenciales_invalidas" };
const h = (n: number) => n.toString(16).padStart(64, "0");

type Cliente = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

describe("intentos de contraseña por cuenta e IP en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("cuenta por pareja y por IP con las funciones definer, sin acceso directo ni datos en claro", async () => {
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
        const ana = randomUUID();
        await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [
          ana, "Ana", "ana@empresa-a.mx", await hashearContrasena(CLAVE),
        ]);
        const repo = repositorioPg();
        const ahora = new Date();
        const antes = (min: number) => new Date(ahora.getTime() - min * 60_000);

        // Pareja: tres fallos viejos, un acierto y dos fallos después: cuentan dos.
        for (const min of [40, 39, 38]) await repo.registrarIntentoContrasena({ correoHash: h(1), ipHash: h(9), exito: false, ahora: antes(min) });
        await repo.registrarIntentoContrasena({ correoHash: h(1), ipHash: h(9), exito: true, ahora: antes(30) });
        for (const min of [5, 3]) await repo.registrarIntentoContrasena({ correoHash: h(1), ipHash: h(9), exito: false, ahora: antes(min) });
        // La IP: otros dos correos con fallos recientes y uno de hace veinte minutos, que ya no cuenta.
        await repo.registrarIntentoContrasena({ correoHash: h(2), ipHash: h(9), exito: false, ahora: antes(1) });
        await repo.registrarIntentoContrasena({ correoHash: h(3), ipHash: h(9), exito: false, ahora: antes(2) });
        await repo.registrarIntentoContrasena({ correoHash: h(4), ipHash: h(9), exito: false, ahora: antes(20) });
        const estado = await repo.estadoIntentosContrasena({ correoHash: h(1), ipHash: h(9), ahora });
        assert.equal(estado.fallosPareja, 2);
        assert.equal(estado.ultimaFalla?.getTime(), antes(3).getTime());
        assert.equal(estado.cuentasIp, 3);
        assert.equal(estado.ipConocida, true);
        assert.deepEqual(await repo.estadoIntentosContrasena({ correoHash: h(5), ipHash: h(8), ahora }), {
          fallosPareja: 0, ultimaFalla: null, cuentasIp: 0, ipConocida: false,
        });

        // De punta a punta: cinco fallos desde una IP y la contraseña correcta espera; desde otra IP entra.
        for (let i = 0; i < 5; i += 1) {
          assert.deepEqual(await iniciarConContrasena({ correo: "ana@empresa-a.mx", contrasena: MALA, ip: "203.0.113.7" }, SIN_PISO), RECHAZO);
        }
        assert.deepEqual(await iniciarConContrasena({ correo: "ana@empresa-a.mx", contrasena: CLAVE, ip: "203.0.113.7" }, SIN_PISO), RECHAZO);
        assert.equal((await iniciarConContrasena({ correo: "ana@empresa-a.mx", contrasena: CLAVE, ip: "198.51.100.9" }, SIN_PISO)).tipo, "entrada");
        const filas = await duena.query("select correo_hash, ip_hash from auth_intentos_contrasena");
        assert.ok(!JSON.stringify(filas.rows).includes("ana@") && !JSON.stringify(filas.rows).includes("203.0"));

        // Se borra lo de más de noventa días.
        await duena.query("insert into auth_intentos_contrasena (correo_hash, ip_hash, exito, ocurrido_en) values ($1, $2, false, now() - interval '91 days')", [h(7), h(7)]);
        await repo.registrarIntentoContrasena({ correoHash: h(6), ipHash: h(6), exito: false, ahora });
        assert.equal((await duena.query("select 1 from auth_intentos_contrasena where correo_hash = $1", [h(7)])).rowCount, 0);

        // La aplicación no toca la tabla directo; las funciones son definer, con el search_path de 0029, solo para el cliente.
        const tabla = (
          await duena.query(
            `select relrowsecurity as rls, relforcerowsecurity as forzada,
                    has_table_privilege('plataforma_cliente', oid, 'select') as cliente_lee,
                    has_table_privilege('plataforma_sofipo', oid, 'insert') as sofipo_escribe
             from pg_class where oid = 'auth_intentos_contrasena'::regclass`,
          )
        ).rows[0];
        assert.deepEqual(tabla, { rls: true, forzada: true, cliente_lee: false, sofipo_escribe: false });
        const funciones = (
          await duena.query(
            `select p.proname as nombre, p.prosecdef as definer, p.proconfig as config,
                    has_function_privilege('plataforma_cliente', p.oid, 'execute') as cliente,
                    has_function_privilege('plataforma_sofipo', p.oid, 'execute') as sofipo
             from pg_proc p where p.proname in ('estado_intentos_contrasena', 'registrar_intento_contrasena') order by 1`,
          )
        ).rows;
        for (const funcion of funciones) {
          assert.deepEqual({ ...funcion, nombre: undefined }, { nombre: undefined, definer: true, config: ["search_path=public, pg_temp"], cliente: true, sofipo: false });
        }
        assert.equal(funciones.length, 2);
      } finally {
        await duena.end();
        await cerrarConexion();
      }
    });
  });
});
