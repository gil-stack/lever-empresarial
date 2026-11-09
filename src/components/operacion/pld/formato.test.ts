import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ETIQUETAS_PLD } from "./bitacora";
import { plazoEnDias, plazoEnDiasHabiles } from "./formato";

describe("textos de PLD", () => {
  it("r2-serv-N12: un día que queda va en singular", () => {
    assert.equal(plazoEnDias(1), "Queda 1 día");
    assert.equal(plazoEnDias(2), "Quedan 2 días");
    assert.equal(plazoEnDias(0), "Vence hoy");
    assert.equal(plazoEnDias(-1), "Fuera de plazo: venció hace 1 día");
    assert.equal(plazoEnDiasHabiles(1, false), "Queda 1 día hábil");
    assert.equal(plazoEnDiasHabiles(3, false), "Quedan 3 días hábiles");
    assert.equal(plazoEnDiasHabiles(0, true), "Fuera de plazo");
  });

  it("r2-serv-N12: en la bitácora, consultar un caso no se lee como abrirlo", () => {
    assert.equal(ETIQUETAS_PLD.pld_caso_abierto, "Abrió un caso de análisis");
    assert.equal(ETIQUETAS_PLD.pld_caso_consultado, "Consultó un caso de análisis");
    const etiquetas = Object.values(ETIQUETAS_PLD);
    assert.equal(new Set(etiquetas).size, etiquetas.length, "cada evento se lee distinto");
  });
});
