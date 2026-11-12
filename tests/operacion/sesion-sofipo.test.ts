import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { factorReciente, VIGENCIA_FACTORES_MS } from "../../src/server/autenticacion/reautenticacion.ts";
import { SESION_SOFIPO } from "./apoyo-alta-regulada.ts";

// r66-N3: el segundo factor de SESION_SOFIPO no puede quedar fechado al cargar el módulo; si no, una suite que espera la
// medianoche de México (o que tarda) choca con la vigencia de 5 min y cambiarRolPersonal pide reautenticarse.
describe("SESION_SOFIPO fecha su segundo factor en cada uso (r66-N3)", () => {
  afterEach(() => mock.timers.reset());

  it("10 minutos después de cargar el módulo, el factor sigue vigente", () => {
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 10 * 60_000 });
    assert.equal(factorReciente(SESION_SOFIPO, { superficie: "sofipo", vigenciaMs: VIGENCIA_FACTORES_MS }), true);
  });

  it("la edad del factor es de 1 s y nunca negativa, aunque la hora se lea antes que el factor", () => {
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-12T05:54:30Z") });
    const ahora = new Date();
    assert.equal(ahora.getTime() - SESION_SOFIPO.segundoFactor.en.getTime(), 1_000);
    assert.equal(factorReciente(SESION_SOFIPO, { superficie: "sofipo", vigenciaMs: VIGENCIA_FACTORES_MS }, ahora), true);
  });
});
