import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { textoLimpio, validarMotivo } from "./flujo/entradas.ts";
import { textoPago } from "./pagos-proveedores.ts";

// líder-N2: el mínimo y el máximo cuentan caracteres, como `char_length` en los CHECK de la base
// (`supplier_payables_motivo` de la 0022 y `expected_collections` de la 0026), no unidades UTF-16.
describe("los textos de pagos y de flujo cuentan caracteres, como la base", () => {
  it("el motivo de excepción de un pago pide 10 caracteres", () => {
    assert.equal(textoPago("Revisar 😀", 500, 10), null);
    assert.equal(textoPago("Pago 😀 ya!", 500, 10), "Pago 😀 ya!");
  });

  it("el motivo de cancelación de un cobro pide 5 caracteres", () => {
    assert.equal(textoLimpio("ok 😀", 500, 5), null);
    assert.equal(validarMotivo("ok 😀").ok, false);
    assert.equal(textoLimpio("ok 😀!", 500, 5), "ok 😀!");
  });

  it("el máximo también cuenta caracteres", () => {
    assert.equal(textoPago("😀".repeat(500), 500), "😀".repeat(500));
    assert.equal(textoPago("😀".repeat(501), 500), null);
    assert.equal(textoLimpio("😀".repeat(500), 500), "😀".repeat(500));
    assert.equal(textoLimpio("😀".repeat(501), 500), null);
  });
});
