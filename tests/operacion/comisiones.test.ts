import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  diaAnterior,
  fechaValida,
  hoyEnMexico,
  normalizarComision,
  textoComision,
} from "../../src/dominio/operacion/comisiones.ts";

const HOY = "2026-11-04";

describe("comisiones enteras del portal SOFIPO", () => {
  it("guarda fondeo en basis points y spei en centavos MXN", () => {
    assert.deepEqual(normalizarComision({ tipo: "fondeo", valor: "250", vigenteDesde: HOY }, HOY), {
      tipo: "fondeo",
      valor: 250,
      moneda: null,
      vigenteDesde: HOY,
    });
    assert.deepEqual(normalizarComision({ tipo: "spei", valor: "1500", vigenteDesde: "2026-11-05" }, HOY), {
      tipo: "spei",
      valor: 1500,
      moneda: "MXN",
      vigenteDesde: "2026-11-05",
    });
    assert.equal(textoComision("fondeo", 250), "2.5 % (250 bp)");
    assert.match(textoComision("spei", 1500), /\$15\.00 MXN/);
  });

  it("admite cero, pero no decimales, signos, notación ni enteros inseguros", () => {
    assert.equal(normalizarComision({ tipo: "fondeo", valor: "0", vigenteDesde: HOY }, HOY).valor, 0);
    for (const valor of ["", "1.5", "-1", "+1", "1e3", " 1 000", "9007199254740992"]) {
      assert.throws(() => normalizarComision({ tipo: "spei", valor, vigenteDesde: HOY }, HOY), /comision_valor_invalido/);
    }
    assert.throws(() => normalizarComision({ tipo: "fondeo", valor: "10001", vigenteDesde: HOY }, HOY), /comision_valor_invalido/);
  });

  it("rechaza fechas imposibles o pasadas y calcula el cierre sin flotantes", () => {
    assert.equal(fechaValida("2026-02-29"), false);
    assert.equal(fechaValida("2028-02-29"), true);
    assert.throws(() => normalizarComision({ tipo: "spei", valor: "1", vigenteDesde: "2026-11-03" }, HOY), /vigencia_en_pasado/);
    assert.equal(diaAnterior("2026-03-01"), "2026-02-28");
    assert.equal(diaAnterior("2028-03-01"), "2028-02-29");
    assert.equal(hoyEnMexico(new Date("2026-11-04T05:59:00Z")), "2026-11-03");
    assert.equal(hoyEnMexico(new Date("2026-11-04T06:00:00Z")), "2026-11-04");
  });
});
