import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PAGINA_LISTADO_69B } from "../../src/dominio/lista-69b.ts";

const RAIZ = new URL("../../", import.meta.url);

describe("la migración 0013", () => {
  it("guarda la copia pública y no guarda dinero ni proveedor", () => {
    const sql = readFileSync(new URL("db/migrations/0013_lista_69b.sql", RAIZ), "utf8");
    assert.match(sql, /create table lista_69b_snapshots/i);
    assert.match(sql, /create table lista_69b_rows/i);
    assert.match(sql, /fecha_archivo date not null/i);
    assert.match(sql, /cargado_en timestamptz not null/i);
    assert.match(sql, /primary key \(snapshot_id, rfc, situacion\)/i);
    assert.match(sql, /la lista 69-B solo acepta inserciones/);
    assert.doesNotMatch(sql, /insert into lista_69b/i);
    const tablas = `${cuerpo(sql, "lista_69b_snapshots")}\n${cuerpo(sql, "lista_69b_rows")}`.toLowerCase();
    assert.doesNotMatch(tablas, /company_id/);
    for (const palabra of ["centavo", "spei", "clabe", "suppliers", "documents"]) {
      assert.equal(tablas.includes(palabra), false, palabra);
    }
  });
});

describe("la consola y el teléfono", () => {
  it("la lista vive en la consola y no en la app del tarjetahabiente", () => {
    const pagina = readFileSync(new URL("src/app/consola/lista-69b/page.tsx", RAIZ), "utf8");
    const panel = readFileSync(new URL("src/components/lista-69b/panel.tsx", RAIZ), "utf8");
    const formulario = readFileSync(new URL("src/components/lista-69b/formulario-cargar.tsx", RAIZ), "utf8");
    const telefono = readFileSync(new URL("src/app/telefono/page.tsx", RAIZ), "utf8");
    const marco = readFileSync(new URL("src/components/cromo/marco.tsx", RAIZ), "utf8");
    const telefonoMarco = marco.slice(marco.indexOf("export async function MarcoTelefono"));
    const dominio = readFileSync(new URL("src/dominio/lista-69b.ts", RAIZ), "utf8");
    const descarga = readFileSync(new URL("src/server/lista-69b/descargar.ts", RAIZ), "utf8");

    assert.match(pagina, /<Marco /);
    assert.equal(pagina.includes("MarcoTelefono"), false);
    assert.equal(panel.includes("MarcoTelefono"), false);
    assert.equal(telefono.includes("69"), false);
    assert.equal(telefonoMarco.includes("lista69b"), false);
    assert.equal(telefonoMarco.includes("seccionesDe"), false);

    const pantalla = `${panel}\n${formulario}\n${pagina}`;
    for (const palabra of ["Pagar", "SPEI", "type=\"file\"", "transferir"]) {
      assert.equal(pantalla.includes(palabra), false, palabra);
    }
    assert.equal(dominio.includes("blob.core.windows.net"), false);
    assert.equal(descarga.includes("blob.core.windows.net"), false);
    assert.equal(dominio.includes(PAGINA_LISTADO_69B), true);
    assert.match(descarga, /PAGINA_LISTADO_69B/);
  });
});

function cuerpo(sql: string, tabla: string): string {
  const inicio = sql.toLowerCase().indexOf(`create table ${tabla}`);
  const fin = sql.indexOf(");", inicio);
  return sql.slice(inicio, fin);
}
