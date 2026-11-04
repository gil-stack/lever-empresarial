import assert from "node:assert/strict";
import { test } from "node:test";

import { digitoClabe } from "../../src/dominio/clabe.ts";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "../aislamiento/esquema.ts";
import {
  aplicarArchivo,
  conBaseDesechable,
  consultarJson,
  ejecutar,
  exigirBaseDesechable,
} from "../aislamiento/postgres.ts";

/**
 * El historial se prueba contra Postgres: un dígito malo no entra, cambiar
 * agrega una fila y ni el UPDATE ni el DELETE borran los 18 dígitos.
 */

const HASH = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
const USUARIO = "22222222-2222-4222-8222-222222222222";
const EMPRESA = "33333333-3333-4333-8333-333333333333";
const PROVEEDOR = "11111111-1111-4111-8111-111111111111";
const PRIMERA = "77777777-7777-4777-8777-777777777777";
const SEGUNDA = "88888888-8888-4888-8888-888888888888";

function armar(diecisiete: string): string {
  const digito = digitoClabe(diecisiete);
  if (digito === null) throw new Error("diecisiete");
  return `${diecisiete}${digito}`;
}

const BANAMEX = armar("00218070115012345");
const FONDOS = armar("64618070115012345");

test("la CLABE del proveedor conserva el historial en Postgres", async () => {
  const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);
  if (esquema.pendiente) throw new Error(esquema.motivo);
  if (!esquema.archivos.some((archivo) => archivo.endsWith("0014_clabes_proveedor.sql"))) {
    throw new Error("Falta db/migrations/0014_clabes_proveedor.sql.");
  }
  for (const tabla of ["0012_proveedores.sql", "0013_lista_69b.sql", "0014_clabes_proveedor.sql"]) {
    if (!esquema.archivos.some((archivo) => archivo.endsWith(tabla))) {
      throw new Error(`Falta db/migrations/${tabla}.`);
    }
  }

  await conBaseDesechable(exigirBaseDesechable(), async (url) => {
    for (const archivo of esquema.archivos) aplicarArchivo(url, archivo);
    sembrar(url);

    assert.throws(() => ejecutar(url, `delete from supplier_clabes where id = '${PRIMERA}'`), /historial_de_clabe_no_se_borra/);
    assert.throws(
      () => ejecutar(url, `update supplier_clabes set clabe = '${FONDOS}' where id = '${PRIMERA}'`),
      /clabe_no_se_pisa/,
    );
    assert.throws(
      () =>
        ejecutar(
          url,
          `insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
           values ('99999999-9999-4999-8999-999999999999', '${EMPRESA}', '${PROVEEDOR}', '002180701150123453', true, now())`,
        ),
      /clabe_digito_371|supplier_clabes_clabe_validada|check/i,
    );

    ejecutar(
      url,
      `begin;
       update supplier_clabes set vigente_hasta = timestamptz '2026-11-04 20:00:00+00'
         where id = '${PRIMERA}';
       insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
         values ('${SEGUNDA}', '${EMPRESA}', '${PROVEEDOR}', '${FONDOS}', true, timestamptz '2026-11-04 20:00:00+00');
       insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
         values ((select id from operators order by alta_en limit 1), '${EMPRESA}', 'miembro', '${USUARIO}', 'cliente', 'clabe_proveedor', 'supplier_clabes', '${SEGUNDA}');
       commit;`,
    );

    const filas = consultarJson<Array<{ clabe: string; abierta: boolean }>>(
      url,
      `select coalesce(json_agg(json_build_object(
          'clabe', clabe,
          'abierta', vigente_hasta is null
        ) order by vigente_desde), '[]'::json)
       from supplier_clabes
       where company_id = '${EMPRESA}'`,
    );
    assert.equal(filas.length, 2);
    assert.deepEqual(
      filas.map((fila) => fila.clabe),
      [BANAMEX, FONDOS],
    );
    assert.equal(filas[0]?.abierta, false);
    assert.equal(filas[1]?.abierta, true);
  });
});

function sembrar(url: string): void {
  ejecutar(
    url,
    `begin;
     insert into users (id, nombre, correo, password_hash)
       values ('${USUARIO}', 'Elena Ríos', 'clabe-historial@ejemplo.mx', '${HASH}');
     insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
       values ('${EMPRESA}', 'EKU9003173C9', 'Escuela Kemper', '06600', '601', 'G03', (select id from operators order by alta_en limit 1), 'activa', true);
     insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
       values ((select id from operators order by alta_en limit 1), '${EMPRESA}', 'miembro', '${USUARIO}', 'cliente', 'alta_empresa', 'companies', '${EMPRESA}');
     insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
       values (
         'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
         '${EMPRESA}',
         'constancias/dddddddd-dddd-4ddd-8ddd-dddddddddddd',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'application/pdf',
         'constancia.pdf',
         timestamptz '2026-11-04 18:40:00+00'
       );
     insert into suppliers (
       id, company_id, document_id, rfc, razon_social, lista_leida_en, boton_pago, alta_en
     ) values (
       '${PROVEEDOR}',
       '${EMPRESA}',
       'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
       'AAA010101AAA',
       'Proveedor de prueba',
       timestamptz '2026-11-04 18:40:00+00',
       false,
       timestamptz '2026-11-04 18:40:00+00'
     );
     insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
       values ((select id from operators order by alta_en limit 1), '${EMPRESA}', 'miembro', '${USUARIO}', 'cliente', 'alta_proveedor', 'suppliers', '${PROVEEDOR}');
     insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
       values ('${PRIMERA}', '${EMPRESA}', '${PROVEEDOR}', '${BANAMEX}', true, timestamptz '2026-11-04 18:40:00+00');
     insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
       values ((select id from operators order by alta_en limit 1), '${EMPRESA}', 'miembro', '${USUARIO}', 'cliente', 'clabe_proveedor', 'supplier_clabes', '${PRIMERA}');
     commit;`,
  );
}
