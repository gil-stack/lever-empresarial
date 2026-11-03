import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PESOS_CLABE, clabeValida, clabeVisible, digitoClabe } from "./clabe.ts";

describe("dígito 3, 7 y 1", () => {
  it("toma el residuo de cada producto y no el de la suma bruta", () => {
    // Posición del 8: peso 7. 8 × 7 = 56, aporta 6. El dígito de 00218070115012345 es 2.
    assert.deepEqual(PESOS_CLABE, [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7]);
    assert.equal(digitoClabe("00218070115012345"), 2);
    const valida = clabeValida("002180701150123452");
    assert.equal(valida.ok, true);
    if (valida.ok) assert.equal(valida.clabe, "002180701150123452");
  });

  it("acepta espacios y rechaza un dígito corrido, letras o longitud distinta", () => {
    const conEspacios = clabeValida("002 180 70115012345-2");
    assert.equal(conEspacios.ok, true);
    assert.equal(clabeValida("002180701150123453").ok, false);
    assert.equal(clabeValida("00218070115012345A").ok, false);
    assert.equal(clabeValida("00218070115012345").ok, false);
    assert.equal(clabeValida("0021807011501234521").ok, false);
    assert.equal(clabeValida("").ok, false);
  });

  it("muestra los 18 dígitos", () => {
    const visible = clabeVisible("002180701150123452");
    assert.equal(visible.replace(/\D/g, ""), "002180701150123452");
    assert.equal(visible.includes("•"), false);
    assert.equal(visible.includes("*"), false);
  });

  it("la migración usa la misma ponderación, dentro del ciclo", () => {
    const sql = readFileSync(new URL("../../db/migrations/0007_maestro_personas.sql", import.meta.url), "utf8");
    assert.match(sql, /ARRAY\[3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7\]/);
    assert.match(sql, /suma := suma \+ \(\(digito \* pesos\[i\]\) % 10\)/);
    assert.doesNotMatch(sql, /create table\s+(spei|payment_orders|payroll|drawers|policies)/i);
  });
});
