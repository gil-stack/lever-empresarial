import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
 * La copia nueva relee al proveedor. La CLABE no cruza de empresa.
 * Cerrar la única vigente no esconde la ficha.
 */

const HASH = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
const USUARIO = "22222222-2222-4222-8222-222222222222";
const EMPRESA = "33333333-3333-4333-8333-333333333333";
const OTRA = "44444444-4444-4444-8444-444444444444";
const ENTRA = "11111111-1111-4111-8111-111111111111";
const SIN_ARCHIVO = "55555555-5555-4555-8555-555555555555";
const CLABE_ENTRA = "77777777-7777-4777-8777-777777777777";
const CLABE_SIN = "66666666-6666-4666-8666-666666666666";
const DOC_ENTRA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DOC_SIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COPIA_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const COPIA_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function armar(diecisiete: string): string {
  const digito = digitoClabe(diecisiete);
  if (digito === null) throw new Error("diecisiete");
  return `${diecisiete}${digito}`;
}

const BANAMEX = armar("00218070115012345");
const FONDOS = armar("64618070115012345");

test("0015 declara la relectura y no abre un riel de dinero", () => {
  const sql = readFileSync(new URL("../../db/migrations/0015_releer_69b_y_clabe.sql", import.meta.url), "utf8");
  assert.match(sql, /clabe_de_otra_empresa/);
  assert.match(sql, /supplier_clabes_proveedor_empresa/);
  assert.match(sql, /releer_proveedores_69b/);
  assert.match(sql, /proveedor_sin_clabe/);
  assert.match(sql, /pago_con_rfc_publicado/);
  assert.match(sql, /constancia_no_se_reescribe/);
  assert.match(sql, /xmin::text::bigint = txid_current\(\) % 4294967296/);
  assert.doesNotMatch(sql, /create table\s+(spei|payment|visa)/i);
});

test("la copia nueva apaga el pago y la CLABE no cruza de empresa", async () => {
  const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);
  if (esquema.pendiente) throw new Error(esquema.motivo);
  await conBaseDesechable(exigirBaseDesechable(), async (url) => {
    for (const archivo of esquema.archivos) aplicarArchivo(url, archivo);
    sembrar(url);

    assert.throws(
      () =>
        ejecutar(
          url,
          `insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
           values ('99999999-9999-4999-8999-999999999999', '${OTRA}', '${ENTRA}', '${FONDOS}', true, now())`,
        ),
      /clabe_de_otra_empresa|supplier_clabes_proveedor_empresa/,
    );

    ejecutar(
      url,
      `begin;
       insert into lista_69b_snapshots (id, fecha_archivo, cargado_en)
         values ('${COPIA_2}', date '2026-10-31', timestamptz '2026-11-04 21:09:00+00');
       insert into lista_69b_rows (snapshot_id, rfc, situacion)
         values ('${COPIA_2}', 'AAA080808HL8', 'Definitivo');
       commit;`,
    );

    const fichas = consultarJson<Array<{ id: string; situacion: string | null; boton: boolean; fecha: string | null }>>(
      url,
      `select coalesce(json_agg(json_build_object(
          'id', id,
          'situacion', situacion_69b,
          'boton', boton_pago,
          'fecha', to_char(lista_fecha, 'YYYY-MM-DD')
        ) order by rfc), '[]'::json)
       from suppliers
       where company_id = '${EMPRESA}'`,
    );
    const entro = fichas.find((fila) => fila.id === ENTRA);
    const limpio = fichas.find((fila) => fila.id === SIN_ARCHIVO);
    assert.equal(entro?.situacion, "Definitivo");
    assert.equal(entro?.boton, false);
    assert.equal(entro?.fecha, "2026-10-31");
    assert.equal(limpio?.situacion, null);
    assert.equal(limpio?.boton, false);
    assert.equal(limpio?.fecha, null);

    assert.throws(
      () => ejecutar(url, `update suppliers set situacion_69b = null, boton_pago = true where id = '${ENTRA}'`),
      /pago_con_rfc_publicado/,
    );
    assert.throws(
      () =>
        ejecutar(
          url,
          `update documents set hash_sha256 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' where id = '${DOC_ENTRA}'`,
        ),
      /constancia_no_se_reescribe/,
    );

    assert.throws(
      () => ejecutar(url, `update supplier_clabes set vigente_hasta = now() where id = '${CLABE_ENTRA}'`),
      /proveedor_sin_clabe/,
    );

    const abiertas = consultarJson<Array<{ n: number }>>(
      url,
      `select coalesce(json_agg(json_build_object('n', n)), '[]'::json)
       from (
         select count(*)::int as n
         from suppliers s
         join supplier_clabes c
           on c.supplier_id = s.id
          and c.company_id = s.company_id
          and c.vigente_hasta is null
         where s.id = '${ENTRA}'
       ) cuentas`,
    );
    assert.equal(abiertas[0]?.n, 1);
  });
});

function sembrar(url: string): void {
  ejecutar(
    url,
    `begin;
     insert into users (id, nombre, correo, password_hash)
       values ('${USUARIO}', 'Elena Ríos', 'relectura@ejemplo.mx', '${HASH}');
     insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi)
       values ('${EMPRESA}', 'EKU9003173C9', 'Escuela Kemper', '06600', '601', 'G03');
     insert into audit_events (id, company_id, actor_id, accion, entidad, identificador, ocurrido_en)
       values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${EMPRESA}', '${USUARIO}', 'alta_empresa', 'companies', '${EMPRESA}', now());
     insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi)
       values ('${OTRA}', 'PAL7202161U0', 'Otra cuenta', '06600', '601', 'G03');
     insert into audit_events (id, company_id, actor_id, accion, entidad, identificador, ocurrido_en)
       values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '${OTRA}', '${USUARIO}', 'alta_empresa', 'companies', '${OTRA}', now());
     insert into lista_69b_snapshots (id, fecha_archivo, cargado_en)
       values ('${COPIA_1}', date '2026-09-30', timestamptz '2026-10-01 15:00:00+00');
     insert into lista_69b_rows (snapshot_id, rfc, situacion)
       values ('${COPIA_1}', 'PAL7202161U0', 'Presunto');
     insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
       values (
         '${DOC_ENTRA}', '${EMPRESA}', 'constancias/${DOC_ENTRA}',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'application/pdf', 'constancia.pdf', timestamptz '2026-10-02 15:00:00+00'
       ),
       (
         '${DOC_SIN}', '${EMPRESA}', 'constancias/${DOC_SIN}',
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         'application/pdf', 'otra.pdf', timestamptz '2026-10-02 15:00:00+00'
       );
     insert into suppliers (
       id, company_id, document_id, snapshot_id, rfc, razon_social,
       situacion_69b, lista_fecha, lista_leida_en, boton_pago, alta_en
     ) values (
       '${ENTRA}', '${EMPRESA}', '${DOC_ENTRA}', '${COPIA_1}',
       'AAA080808HL8', 'Asesores', null, date '2026-09-30',
       timestamptz '2026-10-02 15:00:00+00', true, timestamptz '2026-10-02 15:00:00+00'
     ), (
       '${SIN_ARCHIVO}', '${EMPRESA}', '${DOC_SIN}', null,
       'CABL840215RF4', 'Taller Norte', null, null,
       timestamptz '2026-10-02 15:00:00+00', false, timestamptz '2026-10-02 16:00:00+00'
     );
     insert into audit_events (id, company_id, actor_id, accion, entidad, identificador, ocurrido_en)
       values
         ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '${EMPRESA}', '${USUARIO}', 'alta_proveedor', 'suppliers', '${ENTRA}', now()),
         ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', '${EMPRESA}', '${USUARIO}', 'alta_proveedor', 'suppliers', '${SIN_ARCHIVO}', now());
     insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
       values
         ('${CLABE_ENTRA}', '${EMPRESA}', '${ENTRA}', '${BANAMEX}', true, timestamptz '2026-10-02 15:00:00+00'),
         ('${CLABE_SIN}', '${EMPRESA}', '${SIN_ARCHIVO}', '${FONDOS}', true, timestamptz '2026-10-02 16:00:00+00');
     insert into audit_events (id, company_id, actor_id, accion, entidad, identificador, ocurrido_en)
       values
         ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', '${EMPRESA}', '${USUARIO}', 'clabe_proveedor', 'supplier_clabes', '${CLABE_ENTRA}', now()),
         ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', '${EMPRESA}', '${USUARIO}', 'clabe_proveedor', 'supplier_clabes', '${CLABE_SIN}', now());
     commit;`,
  );
}
