import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { esperarSiLlegaLaMedianoche, hastaLaMedianocheDeMexico, minutosAtrasDeHoy } from "./momento-en-mexico.ts";

// Reloj fijo: cada instante es UTC; la Ciudad de México va en UTC-6 todo el año.
describe("minutosAtrasDeHoy cruza la medianoche de México sin salir de hoy", () => {
  const casos: Array<[string, number, string]> = [
    // De madrugada, restar minutos caería en el día anterior (el acuse quedaría antes del dictamen de hoy).
    ["2026-11-11T06:00:30Z", 1, "2026-11-11T00:00"],
    ["2026-11-11T06:00:30Z", 5, "2026-11-11T00:00"],
    ["2026-11-11T06:05:00Z", 60, "2026-11-11T00:00"],
    ["2026-11-11T06:59:00Z", 60, "2026-11-11T00:00"],
    ["2026-11-12T06:20:00Z", 60, "2026-11-12T00:00"],
    // Pasada la ventana, es «hace N minutos» tal cual.
    ["2026-11-11T07:00:30Z", 60, "2026-11-11T00:00"],
    ["2026-11-11T07:01:00Z", 60, "2026-11-11T00:01"],
    ["2026-11-11T05:59:00Z", 60, "2026-11-10T22:59"],
    ["2026-11-11T11:59:00Z", 60, "2026-11-11T04:59"],
    ["2026-11-11T12:00:00Z", 1, "2026-11-11T05:59"],
    ["2026-11-11T18:00:00Z", 2, "2026-11-11T11:58"],
    ["2026-11-12T00:01:00Z", 5, "2026-11-11T17:56"],
  ];
  for (const [instante, minutos, esperado] of casos) {
    it(`${instante} menos ${minutos} min → ${esperado}`, () => {
      assert.equal(minutosAtrasDeHoy(new Date(instante), minutos), esperado);
    });
  }
});

describe("hastaLaMedianocheDeMexico y esperarSiLlegaLaMedianoche (r66-N1)", () => {
  const casos: Array<[string, number]> = [
    ["2026-11-11T05:59:57Z", 3_000],
    ["2026-11-11T05:50:00Z", 600_000],
    ["2026-11-11T06:00:00Z", 86_400_000],
    ["2026-11-11T18:00:00Z", 43_200_000],
    ["2026-11-12T05:59:59.500Z", 500],
  ];
  for (const [instante, esperado] of casos) {
    it(`${instante} → faltan ${esperado} ms`, () => {
      assert.equal(hastaLaMedianocheDeMexico(new Date(instante)), esperado);
    });
  }
  it("lejos de la medianoche no espera; cerca, espera hasta que pasa", async () => {
    assert.equal(await esperarSiLlegaLaMedianoche(600_000, new Date("2026-11-11T18:00:00Z")), 0);
    const inicio = Date.now();
    const espero = await esperarSiLlegaLaMedianoche(600_000, new Date("2026-11-12T05:59:59.800Z"));
    assert.equal(espero, 1_200);
    assert.ok(Date.now() - inicio >= 1_150);
  });
});
