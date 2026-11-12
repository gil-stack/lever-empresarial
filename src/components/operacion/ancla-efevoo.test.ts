import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { anclaDeTarjeta } from "./ancla-efevoo";

describe("Tarjetas (Efevoo): el ancla de cada tarjeta", () => {
  it("dos tarjetas con la misma terminación tienen anclas distintas (no se repite el id en el HTML)", () => {
    const tarjetas = [
      { id: "8f2c1d3e-1111-4111-8111-111111111111", terminacion: "0168" },
      { id: "8f2c1d3e-2222-4222-8222-222222222222", terminacion: "0168" },
    ];
    const anclas = tarjetas.map((t) => anclaDeTarjeta(t));
    assert.equal(new Set(anclas).size, 2);
  });
});
