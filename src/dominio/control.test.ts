import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validarPdfPrivado } from "./cfdi.ts";
import { textoLimpio } from "./flujo/entradas.ts";
import { leerListaBloqueadas } from "./operacion/lpb.ts";
import { textoMultilinea, textoOperativo } from "./operacion/validar.ts";
import { textoPago } from "./pagos-proveedores.ts";
import { normalizarCentro, normalizarNombrePersona } from "./personas.ts";
import { validarAlta } from "../server/company/validar.ts";

// bar-3: la base cuenta como `[[:cntrl:]]` también los C1 (U+0080 a U+009F), como el U+0085 o las comillas
// U+0093/U+0094 de un Windows-1252 mal decodificado. Antes los validadores solo filtraban C0 y DEL: el texto
// pasaba el servidor y el CHECK lo rechazaba con «La base no respondió». La equivalencia exacta con la base
// la prueba `alta-regulada-postgres.test.ts` contra `pg_c_utf8`.
describe("los validadores rechazan los controles C1 como la base", () => {
  const conC1 = ["Comercio\u0085al por mayor", "Calle \u0093Reforma\u0094"];

  // serv-nuevo-1: en los textos libres el control pegado (invisible) se quita al limpiar, y las longitudes se
  // miden sobre lo limpio: ni aviso falso de longitud o de vacío ni un control que llegue a la base.
  it("los textos libres de Operación, pagos y flujo quitan el control y miden lo limpio", () => {
    for (const [texto, limpio] of [["Calle \u0093Reforma\u0094", "Calle Reforma"], ["Trabajo urgente\u0085 autorizado ya", "Trabajo urgente autorizado ya"]]) {
      assert.equal(textoOperativo(texto, 300), limpio, texto);
      assert.equal(textoMultilinea(texto, 500), limpio, texto);
      assert.equal(textoPago(texto, 500, 10), limpio, texto);
      assert.equal(textoLimpio(texto, 254), limpio, texto);
    }
    assert.equal(textoPago("ok\u0085\u0085\u0085\u0085\u0085\u0085\u0085\u0085", 500, 10), null);
    assert.equal(textoOperativo("\u0085\u0000\u007f", 300), null);
  });

  it("los nombres de personas y áreas siguen rechazando el control", () => {
    for (const texto of conC1) {
      assert.equal(normalizarNombrePersona(texto), null, texto);
      assert.equal(normalizarCentro(texto), null, texto);
    }
  });

  it("la razón social del alta, el renglón de la Lista y el nombre de un PDF privado", () => {
    const alta = validarAlta({ rfc: "EKU9003173C9", razonSocial: "Escuela\u0085Kemper", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" });
    assert.equal(alta.ok, false);
    assert.deepEqual(leerListaBloqueadas("nombre,rfc,curp,tipo,fecha\nBien,,,fisica,\nJuan\u0085Pérez,,,fisica,"), { ok: false, codigo: "lpb_renglon_invalido", linea: 3 });
    const pdf = new TextEncoder().encode(`%PDF-1.4\n${"0".repeat(80)}\n%%EOF\n`);
    assert.deepEqual(validarPdfPrivado("acta\u0093.pdf", pdf), { ok: false });
  });
});
