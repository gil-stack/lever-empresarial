import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { centavosAPesos, pesosACentavos, TOPE_CENTAVOS } from "./montos";

describe("Efevoo: centavos ↔ pesos", () => {
  it("los bordes: 1, 99, 100 y 123456789 centavos", () => {
    assert.equal(centavosAPesos(1), "0.01");
    assert.equal(centavosAPesos(99), "0.99");
    assert.equal(centavosAPesos(100), "1.00");
    assert.equal(centavosAPesos(123456789), "1234567.89");
    assert.equal(centavosAPesos(TOPE_CENTAVOS), "9999999999.99");
  });

  it("sin flotantes: el regreso da los mismos centavos", () => {
    for (const c of [1, 7, 10, 29, 99, 100, 101, 1001, 123456789, 999999999, TOPE_CENTAVOS]) {
      assert.equal(pesosACentavos(centavosAPesos(c)), c, String(c));
      assert.equal(pesosACentavos(Number(centavosAPesos(c))), c, `número ${c}`);
    }
  });

  it("no manda cero, negativos, fracciones ni montos fuera de tope", () => {
    for (const c of [0, -1, 1.5, Number.NaN, TOPE_CENTAVOS + 1, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => centavosAPesos(c), /centavos_invalidos/, String(c));
    }
  });

  it("lee lo que regresa Efevoo: números, texto con cuatro decimales y negativos", () => {
    assert.equal(pesosACentavos(501.01), 50101);
    assert.equal(pesosACentavos(0.1), 10);
    assert.equal(pesosACentavos("500.0000"), 50000);
    assert.equal(pesosACentavos("1000.0000"), 100000);
    assert.equal(pesosACentavos(-999499), -99949900);
    assert.equal(pesosACentavos(60352.34), 6035234);
    assert.equal(pesosACentavos(0), 0);
  });

  it("redondea a centavos de forma explícita, la mitad hacia afuera", () => {
    assert.equal(pesosACentavos("11.8231479059"), 1182);
    assert.equal(pesosACentavos("0.005"), 1);
    assert.equal(pesosACentavos("0.0049"), 0);
    assert.equal(pesosACentavos("-0.005"), -1);
  });

  it("no adivina: nulo con lo que no es un monto", () => {
    for (const v of [null, undefined, "", "abc", "1e3", "1,000.00", "12.", ".5", Number.POSITIVE_INFINITY, 1e21, {}, [], true]) {
      assert.equal(pesosACentavos(v), null, String(v));
    }
  });
});
