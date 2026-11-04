import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { saludoEnMexico } from "./reloj.ts";

describe("saludo de la consola", () => {
  it("usa la hora del centro de México, no la del servidor", () => {
    assert.equal(saludoEnMexico(new Date("2026-11-04T15:00:00Z"), "Laura Méndez"), "Buenos días, Laura");
    assert.equal(saludoEnMexico(new Date("2026-11-04T21:30:00Z"), "Laura Méndez"), "Buenas tardes, Laura");
    assert.equal(saludoEnMexico(new Date("2026-11-05T02:00:00Z"), "Laura Méndez"), "Buenas noches, Laura");
  });

  it("la madrugada todavía es noche", () => {
    assert.equal(saludoEnMexico(new Date("2026-11-04T09:00:00Z"), "Laura"), "Buenas noches, Laura");
  });

  it("sin nombre, solo el saludo", () => {
    assert.equal(saludoEnMexico(new Date("2026-11-04T21:30:00Z"), "   "), "Buenas tardes");
  });
});
