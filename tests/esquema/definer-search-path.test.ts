import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { randomBytes } from "node:crypto";

import { aplicarArchivo, conBaseDesechable, ejecutar, exigirBaseDesechable } from "../aislamiento/postgres.ts";

/**
 * Una función SECURITY DEFINER corre con los privilegios de su dueña. Si su
 * search_path no nombra pg_temp, Postgres busca primero en las tablas temporales
 * de quien llama y una tabla temporal con el nombre de una tabla real la desvía.
 * Con 0029 cada definer lleva «public, pg_temp» y los roles de la aplicación ya
 * no crean tablas temporales. Toda migración posterior que agregue un definer
 * tiene que traer el mismo search_path: esta prueba lo exige.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
const ROLES_APLICACION = ["plataforma_app", "plataforma_cliente", "plataforma_sofipo", "plataforma_tarea"];
const SOMBRA = "sombra@ejemplo.mx";

type Cliente = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

/**
 * Como plataforma_cliente: crea una tabla temporal «users» con una persona
 * inventada y pregunta por ella a dos definers que leen users. Devuelve lo que
 * respondieron. Todo se deshace al final; con `darTemp` el permiso de tablas
 * temporales se presta solo dentro de esta transacción.
 */
async function sonda(duena: Cliente, base: string, darTemp: boolean): Promise<{ usuario: unknown[]; identidad: unknown[] }> {
  await duena.query("begin");
  try {
    if (darTemp) await duena.query(`grant temporary on database "${base}" to plataforma_cliente`);
    await duena.query("set local role plataforma_cliente");
    await duena.query("create temp table users (id uuid, nombre text, correo text, password_hash text)");
    await duena.query("insert into users values (gen_random_uuid(), 'Sombra', $1, '$2b$10$sombra')", [SOMBRA]);
    const usuario = (await duena.query("select nombre from usuario_por_correo($1)", [SOMBRA])).rows;
    const identidad = (await duena.query("select nombre, password_hash from identidad_por_correo($1)", [SOMBRA])).rows;
    return { usuario, identidad };
  } finally {
    await duena.query("rollback");
  }
}

/**
 * En Neon la base no trae la ACL nula de un Postgres local: la dueña la deja
 * explícita y neon_superuser tiene todo (`{=Tc/dueña,dueña=CTc/dueña,neon_superuser=CTc/dueña}`,
 * leído en producción y preview el 2026-11-10). Aquí un rol de prueba hace de neon_superuser.
 */
type Acl = { nombre: string; preparar?: (urlDuena: string, base: string) => void; conserva?: string };

type Empresa = { empresa: string; usuario: string };

/** Una empresa activa con su administradora, sembrada sin disparadores: la prueba no es del alta. */
async function sembrarEmpresa(duena: Cliente): Promise<Empresa> {
  const empresa = String((await duena.query("select gen_random_uuid() as id")).rows[0]!.id);
  const usuario = String((await duena.query("select gen_random_uuid() as id")).rows[0]!.id);
  await duena.query("begin");
  await duena.query("set local session_replication_role = replica");
  await duena.query(
    `insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
     values ($1, 'BIT010101AB1', 'Bitácora Prueba', '06600', '601', 'G03', (select id from operators limit 1), 'activa', false)`,
    [empresa],
  );
  await duena.query("insert into users (id, nombre, correo) values ($1, 'Admin Bitácora', 'admin-bitacora@ejemplo.mx')", [usuario]);
  await duena.query("insert into memberships (user_id, company_id, estado) values ($1, $2, 'activa')", [usuario, empresa]);
  await duena.query("insert into membership_roles (user_id, company_id, rol) values ($1, $2, 'administrador')", [usuario, empresa]);
  await duena.query("commit");
  return { empresa, usuario };
}

/**
 * r64-base-N1: como plataforma_cliente, con el contexto de su empresa, cambia el
 * colchón del flujo de caja. Ese cambio exige su evento en la bitácora
 * (flujo_exige_auditoria → bitacora_tiene_evento, diferido al COMMIT). La tabla
 * temporal audit_log trae un evento falso de esta misma transacción. Si la
 * definer la lee, el COMMIT pasa sin rastro real.
 */
async function sondaBitacora(duena: Cliente, base: string, { empresa, usuario }: Empresa, darTemp: boolean, colchon: number): Promise<void> {
  await duena.query("begin");
  try {
    if (darTemp) await duena.query(`grant temporary on database "${base}" to plataforma_cliente`);
    await duena.query("set local role plataforma_cliente");
    await duena.query("select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true)", [empresa, usuario]);
    await duena.query(
      "create temp table audit_log (company_id uuid, accion text, entidad text, identificador uuid, actor_id uuid, actor_tipo text, txid bigint) on commit drop",
    );
    await duena.query("insert into audit_log values ($1, 'configurar_colchon', 'cash_flow_settings', $1, $2, 'miembro', txid_current())", [empresa, usuario]);
    await duena.query(
      `insert into cash_flow_settings (company_id, colchon_centavos, actualizado_por) values ($1, $2, $3)
       on conflict (company_id) do update set colchon_centavos = excluded.colchon_centavos, actualizado_en = now()`,
      [empresa, colchon, usuario],
    );
    await duena.query("commit");
  } catch (error) {
    await duena.query("rollback");
    throw error;
  }
}

async function rastro(duena: Cliente, empresa: string): Promise<{ colchon: number | null; eventos: number }> {
  const fila = (
    await duena.query(
      `select (select colchon_centavos from cash_flow_settings where company_id = $1)::int as colchon,
              (select count(*) from audit_log where company_id = $1 and entidad = 'cash_flow_settings')::int as eventos`,
      [empresa],
    )
  ).rows[0]!;
  return { colchon: fila.colchon === null ? null : Number(fila.colchon), eventos: Number(fila.eventos) };
}

describe("funciones SECURITY DEFINER frente a las tablas temporales de quien llama", { skip: urlAdmin.length === 0 }, () => {
  const neon = `neon_superuser_${randomBytes(3).toString("hex")}`;
  const casos: Acl[] = [
    { nombre: "ACL nula de la base (Postgres local)" },
    {
      nombre: "ACL explícita como la de Neon",
      preparar: (url, base) => {
        ejecutar(url, `create role ${neon} nologin`);
        ejecutar(url, `grant connect, temporary on database "${base}" to public`);
        ejecutar(url, `grant all on database "${base}" to ${neon}`);
      },
      conserva: neon,
    },
  ];
  for (const acl of casos) {
    it(`${acl.nombre}: antes de 0029 una tabla temporal las desvía; después ya no, aunque se preste el permiso, y la aplicación no crea tablas temporales`, async () => {
      exigirBaseDesechable();
      try {
        await recorrer(acl);
      } finally {
        if (acl.conserva) ejecutar(urlAdmin, `drop role if exists ${acl.conserva}`);
      }
    });
  }
});

async function recorrer(acl: Acl): Promise<void> {
  await conBaseDesechable(urlAdmin, async (urlDuena) => {
    const archivos = readdirSync(MIGRACIONES).filter((a) => a.endsWith(".sql")).sort();
    const antes = archivos.filter((a) => a < "0029");
    const desde = archivos.filter((a) => a >= "0029");
    assert.ok(desde[0]?.startsWith("0029_"), "falta la migración 0029");
    for (const archivo of antes) aplicarArchivo(urlDuena, join(MIGRACIONES, archivo));

    const { Client } = (await import("pg")) as unknown as { Client: new (opts: { connectionString: string }) => Cliente };
    const duena = new Client({ connectionString: urlDuena });
    await duena.connect();
    try {
      const base = String((await duena.query("select current_database() as base")).rows[0]!.base);
      acl.preparar?.(urlDuena, base);
      const aclAntes = String((await duena.query("select coalesce(datacl::text, 'nula') as acl from pg_database where datname = current_database()")).rows[0]!.acl);
      if (acl.preparar) assert.match(aclAntes, /^\{=Tc\//, aclAntes);

      // 1. Sin 0029: la definer lee la tabla temporal de quien llama (prueba que la sonda sí detecta el desvío).
      const desviada = await sonda(duena, base, false);
      assert.deepEqual(desviada.usuario, [{ nombre: "Sombra" }]);
      assert.deepEqual(desviada.identidad, [{ nombre: "Sombra", password_hash: "$2b$10$sombra" }]);
      // r64-base-N1: el cambio que exige bitácora se confirma con el evento falso y sin rastro real.
      const bitacora = await sembrarEmpresa(duena);
      await sondaBitacora(duena, base, bitacora, false, 123_00);
      assert.deepEqual(await rastro(duena, bitacora.empresa), { colchon: 123_00, eventos: 0 });

      for (const archivo of desde) aplicarArchivo(urlDuena, join(MIGRACIONES, archivo));

      // 2. Cada SECURITY DEFINER de public, incluidas las de migraciones posteriores, termina en pg_temp.
      const sinPgTemp = (
        await duena.query(
          `select p.oid::regprocedure::text as funcion, coalesce(array_to_string(p.proconfig, ' · '), 'sin configuración') as config
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prosecdef and n.nspname = 'public'
             and not (coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'])
           order by 1`,
        )
      ).rows;
      assert.deepEqual(sinPgTemp, [], "Toda función SECURITY DEFINER lleva SET search_path = public, pg_temp");
      const definers = Number((await duena.query("select count(*)::int as n from pg_proc where prosecdef")).rows[0]!.n);
      assert.ok(definers >= 54, `definers revisadas: ${definers}`);

      // 3. Ningún rol de la aplicación crea tablas temporales; se intenta de verdad como plataforma_cliente.
      const conTemp = (
        await duena.query(
          "select rolname from pg_roles where rolname = any($1) and has_database_privilege(rolname, current_database(), 'TEMPORARY') order by 1",
          [ROLES_APLICACION],
        )
      ).rows;
      assert.deepEqual(conTemp, []);
      const permisos = (
        await duena.query(
          `select has_database_privilege('public', current_database(), 'TEMPORARY') as publico,
                  has_database_privilege('public', current_database(), 'CONNECT') as conectar,
                  has_database_privilege(datdba, current_database(), 'TEMPORARY') as duena
           from pg_database where datname = current_database()`,
        )
      ).rows[0];
      assert.deepEqual(permisos, { publico: false, conectar: true, duena: true });
      if (acl.conserva) {
        const conserva = (await duena.query("select has_database_privilege($1, current_database(), 'TEMPORARY') as t", [acl.conserva])).rows[0];
        assert.deepEqual(conserva, { t: true }, `${acl.conserva} conserva TEMP`);
      }
      // En una conexión nueva el rechazo es el del privilegio. En esta sesión, que ya tiene su esquema temporal
      // desde la fase sin 0029, Postgres niega crear en ese esquema. Las dos respuestas son 42501.
      const nueva = new Client({ connectionString: urlDuena });
      await nueva.connect();
      try {
        await assert.rejects(sonda(nueva, base, false), (error: { code?: string; message?: string }) => {
          assert.equal(error.code, "42501", error.message);
          assert.match(error.message ?? "", /permission denied to create temporary tables/);
          return true;
        });
      } finally {
        await nueva.end();
      }
      const negado = (error: { code?: string; message?: string }) => {
        assert.equal(error.code, "42501", error.message);
        return true;
      };
      await assert.rejects(sonda(duena, base, false), negado);
      await assert.rejects(sondaBitacora(duena, base, bitacora, false, 456_00), negado);

      // 4. Aunque alguien vuelva a dar el permiso, la definer ya no ve la tabla temporal: lee la real.
      await assert.rejects(sondaBitacora(duena, base, bitacora, true, 456_00), /auditoria_de_flujo_ausente/);
      assert.deepEqual(await rastro(duena, bitacora.empresa), { colchon: 123_00, eventos: 0 });
      await duena.query("insert into users (id, nombre, correo, password_hash) values (gen_random_uuid(), 'Real', $1, null)", [SOMBRA]);
      const protegida = await sonda(duena, base, true);
      assert.deepEqual(protegida.usuario, [{ nombre: "Real" }]);
      assert.deepEqual(protegida.identidad, [{ nombre: "Real", password_hash: null }]);
    } finally {
      await duena.end();
    }
  });
}
