import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fechaDeCalendario, textoMultilinea, textoOperativo } from "../../dominio/operacion/validar.ts";
import { motivoEscrito } from "./formulario.ts";

describe("motivo escrito", () => {
  // base-N20 = serv-N18: el mínimo cuenta caracteres, como `char_length` en los CHECK de la base.
  it("cuenta caracteres, no unidades UTF-16", () => {
    assert.throws(() => motivoEscrito("Revisar 😀", 500), /motivo_corto/);
    assert.throws(() => motivoEscrito("ok 👍👍👍👍", 500), /motivo_corto/);
    assert.equal(motivoEscrito("Revisarlo😀", 500), "Revisarlo😀");
  });

  // Los CHECK de motivo y detalle (0017, 0021 y 0028) no aceptan saltos de línea ni tabuladores: el
  // texto escrito en varios renglones se guarda en uno, y el mínimo cuenta lo que se guarda.
  it("junta los renglones en uno y cuenta lo que se guarda", () => {
    assert.equal(motivoEscrito("Operaciones inusuales\r\n\r\n en revisión", 500), "Operaciones inusuales en revisión");
    assert.equal(motivoEscrito("  Falta el poder\n\tdel apoderado  \n", 500), "Falta el poder del apoderado");
    assert.throws(() => motivoEscrito("Revisar\r\n\r\n\r\n", 500), /motivo_corto/);
    assert.throws(() => motivoEscrito("abc\r\n\r\n\r\n\r\ndef", 500), /motivo_corto/);
    assert.equal(textoMultilinea("Seguimiento\r\noperativo", 500), "Seguimiento operativo");
    assert.doesNotMatch(textoMultilinea("uno\rdos\nтри\tcuatro", 500) ?? "", /[\u0000-\u001f\u007f]/);
    // serv-nuevo-1: los demás controles invisibles se quitan al limpiar.
    assert.equal(textoMultilinea("con\u0007campana", 500), "concampana");
    assert.equal(textoMultilinea("\r\n\t ", 500), null);
  });
});

// bar-4: las fechas del expediente y de la Lista existen en el calendario y son del año 1 en adelante, como
// el tipo `date` de la base (antes bastaba la forma «AAAA-MM-DD» y la base respondía 22008).
describe("fecha de calendario", () => {
  it("rechaza días que no existen y el año 0", () => {
    for (const mala of ["2026-02-30", "2020-02-30", "1980-02-30", "2100-02-29", "0000-01-01", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-01"]) {
      assert.equal(fechaDeCalendario(mala), false, mala);
    }
    for (const buena of ["2024-02-29", "2000-02-29", "0001-01-01", "1980-05-01", "2026-12-31"]) {
      assert.equal(fechaDeCalendario(buena), true, buena);
    }
  });
});

// base-N22: el máximo también cuenta caracteres, como `char_length` en los CHECK (antes, unidades UTF-16:
// 260 emojis no cabían en un motivo de 500 y 151 en un texto de 300).
describe("el máximo de los textos de Operación cuenta caracteres", () => {
  it("260 emojis caben en un motivo de 500 y 151 en un texto de 300", () => {
    assert.equal(motivoEscrito("😀".repeat(260), 500), "😀".repeat(260));
    assert.equal(textoOperativo("😀".repeat(151), 300), "😀".repeat(151));
    assert.equal(textoMultilinea("😀".repeat(501), 500), null);
    assert.equal(textoOperativo("😀".repeat(301), 300), null);
  });
});
