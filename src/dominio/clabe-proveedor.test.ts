import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { digitoClabe } from "./clabe.ts";
import {
  FRASE_INSTITUCION_PENDIENTE,
  INSTITUCIONES_TRADICIONALES,
  institucionTradicional,
  momentoClabe,
  presentarClabe,
  puedeCambiarClabeProveedor,
  puedeVerClabeProveedor,
} from "./clabe-proveedor.ts";

function armar(diecisiete: string): string {
  const digito = digitoClabe(diecisiete);
  if (digito === null) throw new Error("diecisiete");
  return `${diecisiete}${digito}`;
}

const BANAMEX = armar("00218070115012345");
const BBVA = armar("01218070115012345");
const FONDOS = armar("64618070115012345");
const MERCADO = armar("72218070115012345");
const OXXO = armar("72818070115012345");
const CASA = armar("60018070115012345");

describe("catálogo tradicional de la CLABE", () => {
  it("nombra solo la institución de crédito, con el nombre publicado", () => {
    assert.equal(Object.keys(INSTITUCIONES_TRADICIONALES).length, 52);
    assert.equal(institucionTradicional("002"), "BANAMEX");
    assert.equal(institucionTradicional("012"), "BBVA MEXICO");
    assert.equal(institucionTradicional("124"), "CITI MEXICO");
    assert.equal(institucionTradicional("128"), "KAPITAL");
    assert.equal(institucionTradicional("138"), "UALA");
    assert.equal(institucionTradicional("167"), "HEY BANCO");
    assert.equal(institucionTradicional("638"), "NUBANK");
    assert.equal(institucionTradicional("40012"), null);
    assert.equal(institucionTradicional("12"), null);

    const banamex = presentarClabe(BANAMEX);
    assert.equal(banamex.ok, true);
    if (!banamex.ok) return;
    assert.equal(banamex.clabe.visible.replace(/\D/g, ""), BANAMEX);
    assert.equal(banamex.clabe.institucion.conocida, true);
    if (banamex.clabe.institucion.conocida) {
      assert.equal(banamex.clabe.institucion.nombre, "BANAMEX");
    }

    const bbva = presentarClabe(`012 180 70115012345 ${BBVA.at(-1)}`);
    assert.equal(bbva.ok, true);
    if (bbva.ok && bbva.clabe.institucion.conocida) {
      assert.equal(bbva.clabe.institucion.nombre, "BBVA MEXICO");
    }
  });

  it("no adivina el nombre si el código no es de institución de crédito", () => {
    for (const codigo of ["646", "722", "728", "710", "721", "659", "600", "601", "001", "143", "999"]) {
      assert.equal(institucionTradicional(codigo), null, codigo);
    }
    for (const nombre of Object.values(INSTITUCIONES_TRADICIONALES)) {
      assert.equal(/STP|Mercado|OXXO|SPIN|NVIO|Fintoc|Klar|albo/i.test(nombre), false, nombre);
    }

    for (const clabe of [FONDOS, MERCADO, OXXO, CASA]) {
      const presentada = presentarClabe(clabe);
      assert.equal(presentada.ok, true);
      if (!presentada.ok) continue;
      assert.equal(presentada.clabe.visible.replace(/\D/g, ""), clabe);
      assert.equal(presentada.clabe.visible.includes("•"), false);
      assert.equal(presentada.clabe.visible.includes("*"), false);
      assert.deepEqual(presentada.clabe.institucion, {
        conocida: false,
        frase: FRASE_INSTITUCION_PENDIENTE,
      });
      assert.equal(JSON.stringify(presentada).includes("STP"), false);
      assert.equal(JSON.stringify(presentada).includes("Mercado"), false);
    }
  });

  it("rechaza el dígito corrido antes de nombrar un banco", () => {
    assert.deepEqual(presentarClabe("002180701150123453"), { ok: false, codigo: "clabe_invalida" });
    assert.deepEqual(presentarClabe(""), { ok: false, codigo: "clabe_invalida" });
  });

  it("dice la hora de la Ciudad de México", () => {
    assert.equal(
      momentoClabe(new Date("2026-11-04T18:40:00.000Z")),
      "4 de noviembre de 2026 a las 12:40, hora del centro de México",
    );
  });

  it("la ve finanzas en la consola y solo el administrador la cambia", () => {
    assert.equal(puedeVerClabeProveedor("administrador"), true);
    assert.equal(puedeVerClabeProveedor("liberador"), true);
    assert.equal(puedeVerClabeProveedor("contador"), true);
    assert.equal(puedeVerClabeProveedor("solicitante"), false);
    assert.equal(puedeVerClabeProveedor("tarjetahabiente"), false);
    assert.equal(puedeCambiarClabeProveedor("administrador"), true);
    assert.equal(puedeCambiarClabeProveedor("contador"), false);
    assert.equal(puedeCambiarClabeProveedor("liberador"), false);
  });
});

describe("la migración 0014 guarda el historial y no envía dinero", () => {
  const sql = readFileSync(new URL("../../db/migrations/0014_clabes_proveedor.sql", import.meta.url), "utf8");

  it("agrega la fila, cierra la vigencia y no borra los dígitos", () => {
    assert.match(sql, /clabe_digito_371\(clabe\)/);
    assert.match(sql, /RAISE EXCEPTION 'clabe_no_se_pisa'/);
    assert.match(sql, /RAISE EXCEPTION 'historial_de_clabe_no_se_borra'/);
    assert.match(sql, /RAISE EXCEPTION 'clabe_ya_cerrada'/);
    assert.match(sql, /accion = 'clabe_proveedor'/);
    assert.match(sql, /supplier_clabes_una_vigente/);
    assert.doesNotMatch(sql, /create table\s+suppliers/i);
    assert.doesNotMatch(sql, /create table\s+(spei|payment_orders|payroll|lista_69b|documents)/i);
    assert.doesNotMatch(sql, /alter table\s+employees/i);
    assert.doesNotMatch(sql, /delete from\s+supplier_clabes/i);
  });
});

describe("la CLABE vive en la consola y no en el teléfono", () => {
  it("el historial está en proveedores y la barra no abre otra sección", () => {
    const telefono = readFileSync(new URL("../app/telefono/page.tsx", import.meta.url), "utf8");
    const menu = readFileSync(new URL("../components/cromo/secciones.ts", import.meta.url), "utf8");
    const marco = readFileSync(new URL("../components/cromo/marco.tsx", import.meta.url), "utf8");
    const telefonoMarco = marco.slice(marco.indexOf("export async function MarcoTelefono"));
    const pagina = readFileSync(new URL("../app/consola/proveedores/page.tsx", import.meta.url), "utf8");
    const cambio = readFileSync(new URL("../components/proveedores/formulario-cambio.tsx", import.meta.url), "utf8");
    const marcoInicio = marco.indexOf("export async function MarcoTelefono");
    const marcoFin = marco.indexOf("\nfunction Grupo", marcoInicio);
    const telefonoCuerpo = marco.slice(marcoInicio, marcoFin);

    assert.equal(telefono.includes("proveedores"), false);
    assert.equal(telefono.includes("69"), false);
    assert.equal(telefono.includes("MarcoTelefono"), true);
    assert.equal(telefonoMarco.includes("seccionesDe"), false);
    assert.equal(telefonoMarco.includes("proveedores"), false);
    assert.match(menu, /\/consola\/proveedores/);
    assert.match(menu, /\/consola\/lista-69b/);
    assert.equal(menu.includes("/consola/clabe"), false);
    assert.equal(pagina.includes("MarcoTelefono"), false);
    assert.match(pagina, /Marco/);
    assert.match(cambio, /digitos.length >= 18/);
    assert.match(cambio, /Esa CLABE no cierra/);
    assert.equal(telefonoCuerpo.includes("CLABE"), false);
    assert.equal(telefonoCuerpo.includes("PIE_REGULATORIO"), false);
    assert.doesNotMatch(telefonoCuerpo, /El saldo vive/);
    assert.match(telefonoCuerpo, /marca-app/);
    assert.match(telefonoCuerpo, /pie-app/);
    // El aviso vigente hasta que legal apruebe el nuevo; el texto del diseño (SOFIPO por definir) no se publica.
    assert.match(marco, /El saldo vive con el participante de la CLABE\. El plástico vive con el emisor\./);
    assert.doesNotMatch(marco, /Sociedad Financiera Popular|razón social por definir/);
  });
});
