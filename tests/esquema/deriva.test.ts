import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "../aislamiento/esquema.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, exigirBaseDesechable } from "../aislamiento/postgres.ts";

/**
 * Después de aplicar el repositorio, el libro vivo tiene esas tablas y
 * ninguna tabla de la aplicación queda sin seguridad a nivel de filas.
 */
test("el esquema vivo coincide con las migraciones y toda tabla tiene RLS", async () => {
  const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);
  if (esquema.pendiente) throw new Error(esquema.motivo);
  const declaradas = tablasDeclaradas(esquema.archivos);

  await conBaseDesechable(exigirBaseDesechable(), async (url) => {
    for (const archivo of esquema.archivos) aplicarArchivo(url, archivo);
    const vivas = consultarJson<string[]>(
      url,
      `select coalesce(json_agg(tablename order by tablename), '[]'::json)
       from pg_tables
       where schemaname = 'public' and tablename <> 'schema_migrations'`,
    );
    for (const tabla of declaradas) {
      assert.equal(vivas.includes(tabla), true, tabla);
    }

    const sinRls = consultarJson<string[]>(
      url,
      `select coalesce(json_agg(clase.relname order by clase.relname), '[]'::json)
       from pg_class clase
       join pg_namespace espacio on espacio.oid = clase.relnamespace
       where espacio.nspname = 'public'
         and clase.relkind = 'r'
         and clase.relname <> 'schema_migrations'
         and clase.relrowsecurity = false`,
    );
    assert.deepEqual(sinRls, []);

    const saltan = consultarJson<string[]>(
      url,
      `select coalesce(json_agg(rolname order by rolname), '[]'::json)
       from pg_roles
       where rolname in ('plataforma_cliente', 'plataforma_sofipo')
         and rolbypassrls`,
    );
    assert.deepEqual(saltan, []);
  });
});

function tablasDeclaradas(archivos: readonly string[]): string[] {
  const tablas = new Set<string>();
  for (const archivo of archivos) {
    const sql = readFileSync(archivo, "utf8");
    for (const coincidencia of sql.matchAll(/create table(?: if not exists)?\s+([a-z0-9_]+)/gi)) {
      const nombre = coincidencia[1];
      if (nombre) tablas.add(nombre.toLowerCase());
    }
  }
  assert.equal(readdirSync(path.dirname(archivos[0] ?? ".")).filter((nombre) => nombre.endsWith(".sql")).length > 0, true);
  return [...tablas];
}
