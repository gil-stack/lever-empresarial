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
    // serv-nuevo-4: cualquier otro control invisible vale un espacio (no pega palabras) y se juntan los espacios.
    assert.equal(textoMultilinea("con\u0007campana", 500), "con campana");
    assert.equal(textoMultilinea("Falta  la \u0085 constancia", 500), "Falta la constancia");
    assert.equal(textoMultilinea("\r\n\t ", 500), null);
  });

  // Décima revisión: un texto sin nada que se vea (solo Default_Ignorable_Code_Point y espacios) está vacío, y el
  // mínimo del motivo cuenta lo que se ve. La base acepta 10 U+3164 (char_length 10); el servidor es más estricto.
  it("un texto hecho solo de invisibles está vacío y el mínimo cuenta lo que se ve", () => {
    for (const vacio of ["ㅤ", "ㅤ".repeat(10), "​⁠﻿", " ᅟ ﾠ ", "᠋឴\u{e0100}"]) {
      assert.equal(textoOperativo(vacio, 300), null, JSON.stringify(vacio));
      assert.equal(textoMultilinea(vacio, 500), null, JSON.stringify(vacio));
      assert.throws(() => motivoEscrito(vacio, 500), /motivo_invalido/, JSON.stringify(vacio));
    }
    // Diez caracteres en la base, siete que se ven.
    assert.throws(() => motivoEscrito("Revisarㅤㅤㅤ", 500), /motivo_corto/);
    // Onceava revisión: el Braille en blanco (U+2800) y los 32 de formato (Cf) que no son Default_Ignorable no se ven.
    for (const vacio of ["\u2800".repeat(10), "\ufff9".repeat(10), "\u0600\u06dd\u{110bd}\u{13430}", " \u2800 \ufffa "]) {
      assert.equal(textoOperativo(vacio, 300), null, JSON.stringify(vacio));
      assert.equal(textoMultilinea(vacio, 500), null, JSON.stringify(vacio));
      assert.throws(() => motivoEscrito(vacio, 500), /motivo_invalido/, JSON.stringify(vacio));
    }
    assert.throws(() => motivoEscrito("Revisar\u2800\u2800\u2800", 500), /motivo_corto/);
    assert.throws(() => motivoEscrito("Revisar\ufff9\u0600\u06dd", 500), /motivo_corto/);
    assert.equal(motivoEscrito("Revisar el poder\u2800", 500), "Revisar el poder\u2800");
    // El emoji con su selector o unido con U+200D, en un texto con contenido, se queda tal cual.
    assert.equal(motivoEscrito("Gracias por el apoyo ❤️", 500), "Gracias por el apoyo ❤️");
    assert.equal(motivoEscrito("Lo revisó la familia 👨‍👩‍👧", 500), "Lo revisó la familia 👨‍👩‍👧");
    assert.equal(textoOperativo("Abarrotes ❤️", 200), "Abarrotes ❤️");
    assert.equal(textoOperativo("❤️", 200), "❤️");
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
