import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { aplicarArchivoEnTransaccion, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable } from "../aislamiento/postgres.ts";

/**
 * Empresa suspendida (r63-base-N5, r64-base-N4): toda tabla de public con
 * company_id que plataforma_cliente escribe lleva el disparador
 * bloqueo_empresa_suspendida, salvo las excepciones de abajo, sin importar si
 * la migración que lo define (la 0028) entró antes o después de las demás. Una
 * migración nueva que olvide pegarlo hace fallar esta prueba con el nombre de
 * la tabla.
 *
 * Mientras la 0028 no está en la rama, la prueba usa su réplica
 * (fixtures/0028_bloqueo_empresa_suspendida.sql); cuando está, la de verdad.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const AQUI = dirname(fileURLToPath(import.meta.url));
const MIGRACIONES = join(AQUI, "../../db/migrations");
const REPLICA = join(AQUI, "fixtures/0028_bloqueo_empresa_suspendida.sql");
const DEFINE = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+bloqueo_empresa_suspendida\s*\(\s*\)/i;

/** Tablas con company_id que plataforma_cliente escribe y que, a propósito, no llevan el disparador. */
const EXCEPCIONES: Readonly<Record<string, string>> = {
  audit_log: "La bitácora sigue recibiendo eventos de una empresa suspendida: suspender no calla el registro (0028).",
};

const SQL_FALTANTES = `
  select coalesce(json_agg(c.table_name order by c.table_name), '[]'::json)
    from (select distinct c.table_name
            from information_schema.columns c
            join information_schema.role_table_grants g
              on g.table_schema = c.table_schema and g.table_name = c.table_name
             and g.grantee = 'plataforma_cliente' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
            join information_schema.tables t
              on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'company_id'
             and c.table_name <> all($EXCEPCIONES$)
             and not exists (select 1 from pg_trigger x
                              where x.tgrelid = format('public.%I', c.table_name)::regclass
                                and x.tgname = 'bloqueo_empresa_suspendida' and not x.tgisinternal)) c`;

const SQL_DISPARADORES = `
  select coalesce(json_agg(d.def order by d.def), '[]'::json)
    from (select pg_get_triggerdef(x.oid) as def
            from pg_trigger x join pg_class k on k.oid = x.tgrelid join pg_namespace n on n.oid = k.relnamespace
           where n.nspname = 'public' and x.tgname = 'bloqueo_empresa_suspendida' and not x.tgisinternal) d`;

type Migraciones = { resto: string[]; definidora: string; real: boolean };

function migraciones(): Migraciones {
  const todas = readdirSync(MIGRACIONES).filter((f) => f.endsWith(".sql")).sort().map((f) => join(MIGRACIONES, f));
  const real = todas.find((a) => DEFINE.test(readFileSync(a, "utf8")));
  return real ? { resto: todas.filter((a) => a !== real), definidora: real, real: true } : { resto: todas, definidora: REPLICA, real: false };
}

/** La 0028 en su lugar: todo en orden de número. */
function enOrden(m: Migraciones, url: string): string[] {
  const orden = [...m.resto, m.definidora].sort((a, b) => basename(a).localeCompare(basename(b)));
  for (const archivo of orden) aplicarArchivoEnTransaccion(url, archivo);
  return orden.map((a) => basename(a));
}

/**
 * La 0028 después: primero todo lo que no depende de ella (como cuando otra
 * rama se desplegó antes), luego la 0028 y al final lo que la necesitaba.
 */
function conLaDefinidoraAlFinal(m: Migraciones, url: string): string[] {
  const aplicadas: string[] = [];
  const pendientes: string[] = [];
  for (const archivo of m.resto) {
    try {
      aplicarArchivoEnTransaccion(url, archivo);
      aplicadas.push(basename(archivo));
    } catch {
      pendientes.push(archivo);
    }
  }
  aplicarArchivoEnTransaccion(url, m.definidora);
  aplicadas.push(basename(m.definidora));
  for (const archivo of pendientes) {
    aplicarArchivoEnTransaccion(url, archivo);
    aplicadas.push(basename(archivo));
  }
  return aplicadas;
}

function revisar(url: string, orden: string): string[] {
  const excepciones = `array[${Object.keys(EXCEPCIONES).map((t) => `'${t}'`).join(", ")}]::text[]`;
  const faltan = consultarJson<string[]>(url, SQL_FALTANTES.replace("$EXCEPCIONES$", excepciones));
  assert.deepEqual(faltan, [], `${orden}: tablas sin bloqueo_empresa_suspendida: ${faltan.join(", ")}`);
  // Y bloquea de verdad: una empresa suspendida no escribe en cobranza como plataforma_cliente.
  const empresa = randomUUID();
  ejecutar(url, `
    set session_replication_role = replica;
    insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
      values ('${empresa}', 'SUS010101AB1', 'Empresa Suspendida', '06600', '601', 'G03', (select id from operators order by alta_en limit 1), 'suspendida', false);
    set session_replication_role = origin;`);
  assert.throws(
    () => ejecutar(url, `
      begin;
      set local role plataforma_cliente;
      select set_config('app.company_id', '${empresa}', true);
      insert into collection_customers (id, company_id, nombre, correos, creado_por, actualizado_por)
        values (gen_random_uuid(), '${empresa}', 'Cliente', array['c@ejemplo.mx'], null, null);
      commit;`),
    /empresa_suspendida/,
    `${orden}: la empresa suspendida escribió en collection_customers`,
  );
  return consultarJson<string[]>(url, SQL_DISPARADORES);
}

describe("Empresa suspendida en todas las tablas que escribe el cliente", { skip: urlAdmin.length === 0 }, () => {
  it("con la 0028 antes y después de las demás migraciones, el mismo disparador en las mismas tablas", async () => {
    const admin = exigirBaseDesechable();
    const m = migraciones();
    let antes: string[] = [];
    let despues: string[] = [];
    await conBaseDesechable(admin, async (url) => {
      enOrden(m, url);
      antes = revisar(url, `orden por número (${m.real ? "0028 real" : "réplica de la 0028"} antes)`);
    });
    await conBaseDesechable(admin, async (url) => {
      const orden = conLaDefinidoraAlFinal(m, url);
      despues = revisar(url, `0028 después (${orden.join(" → ")})`);
    });
    assert.ok(antes.some((d) => d.includes(" ON public.collection_charges ")), "collection_charges lleva el disparador");
    assert.deepEqual(despues, antes);
  });
});
