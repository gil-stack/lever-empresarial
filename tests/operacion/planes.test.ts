import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calcularCobro, nombreDelMes, normalizarPlan, periodoDeMes, pesosParaCampo } from "../../src/dominio/operacion/planes.ts";

describe("planes de mensualidad y costo por SPEI", () => {
  it("lee pesos con o sin signo, comas y centavos", () => {
    assert.deepEqual(normalizarPlan({ nombre: "  Plan   Pro ", mensualidad: "$3,500.50", spei: "6" }), {
      nombre: "Plan Pro",
      mensualidadCentavos: 350050,
      speiCentavos: 600,
    });
    assert.deepEqual(normalizarPlan({ nombre: "Gratis", mensualidad: "0", spei: "0.00" }), {
      nombre: "Gratis",
      mensualidadCentavos: 0,
      speiCentavos: 0,
    });
  });

  it("rechaza cada campo con su propio código", () => {
    assert.throws(() => normalizarPlan({ nombre: "", mensualidad: "1", spei: "1" }), /plan_nombre_invalido/);
    assert.throws(() => normalizarPlan({ nombre: "a".repeat(61), mensualidad: "1", spei: "1" }), /plan_nombre_invalido/);
    assert.throws(() => normalizarPlan({ nombre: "Pro​", mensualidad: "1", spei: "1" }), /plan_nombre_invalido/);
    assert.throws(() => normalizarPlan({ nombre: "Pro", mensualidad: "", spei: "1" }), /plan_mensualidad_invalida/);
    assert.throws(() => normalizarPlan({ nombre: "Pro", mensualidad: "-5", spei: "1" }), /plan_mensualidad_invalida/);
    assert.throws(() => normalizarPlan({ nombre: "Pro", mensualidad: "1000000001", spei: "1" }), /plan_mensualidad_invalida/);
    assert.throws(() => normalizarPlan({ nombre: "Pro", mensualidad: "1", spei: "abc" }), /plan_spei_invalido/);
    assert.throws(() => normalizarPlan({ nombre: "Pro", mensualidad: "1", spei: "100000.01" }), /plan_spei_invalido/);
  });

  it("muestra los centavos en el campo como pesos", () => {
    assert.equal(pesosParaCampo(150000), "1500.00");
    assert.equal(pesosParaCampo(805), "8.05");
  });

  it("suma la mensualidad y cada SPEI por su costo", () => {
    assert.deepEqual(calcularCobro({ mensualidadCentavos: 150000, speiCentavos: 800, spei: 12 }), {
      speiCentavosTotal: 9600,
      totalCentavos: 159600,
    });
    assert.deepEqual(calcularCobro({ mensualidadCentavos: 0, speiCentavos: 800, spei: 0 }), { speiCentavosTotal: 0, totalCentavos: 0 });
    assert.throws(() => calcularCobro({ mensualidadCentavos: -1, speiCentavos: 0, spei: 0 }), /cobro_invalido/);
  });

  it("el mes va en hora de la Ciudad de México y uno mal escrito vuelve al de hoy", () => {
    assert.deepEqual(periodoDeMes("2026-12", "2026-11-23"), {
      mes: "2026-12",
      desde: "2026-12-01T00:00:00-06:00",
      hasta: "2027-01-01T00:00:00-06:00",
      ultimoDia: "2026-12-31",
    });
    assert.equal(periodoDeMes("2028-02", "2026-11-23").ultimoDia, "2028-02-29");
    for (const malo of ["2026-13", "26-11", "", undefined, ["2026-11"], "1999-01"]) {
      assert.equal(periodoDeMes(malo, "2026-11-23").mes, "2026-11", String(malo));
    }
    assert.equal(nombreDelMes("2026-11"), "noviembre de 2026");
  });
});
