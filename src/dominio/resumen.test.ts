import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { armarResumenInicio, fechaMovimiento, mesesDelPeriodo, periodoResumen, type DatosResumenInicio } from "./resumen.ts";

const datos: DatosResumenInicio = {
  saldoCentavos: 120000,
  mensuales: [
    { clave: "2026-10", ingresosCentavos: 100000, gastosCentavos: 40000 },
    { clave: "2026-11", ingresosCentavos: 50000, gastosCentavos: 70000 },
  ],
  categorias: [
    { codigo: "nomina", nombre: "Nómina", gastosCentavos: 30000 },
    { codigo: "proveedores", nombre: "Proveedores", gastosCentavos: 40000 },
  ],
  recientes: [{ id: "11111111-1111-4111-8111-111111111111", motivo: "Nómina quincenal", categoria: "Nómina", centavos: -30000, ocurridoEn: "2026-11-05T06:30:00.000Z" }],
};

describe("resumen financiero", () => {
  it("rellena los meses sin asientos y calcula el mes actual", () => {
    const resumen = armarResumenInicio(datos, "2026-11-05", 6);
    assert.equal(resumen.meses.length, 6);
    assert.deepEqual(resumen.meses.map((mes) => mes.clave), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    assert.equal(resumen.meses[0]?.ingresosCentavos, 0);
    assert.equal(resumen.ingresosMesCentavos, 50000);
    assert.equal(resumen.gastosMesCentavos, 70000);
    assert.equal(resumen.resultadoMesCentavos, -20000);
    assert.equal(resumen.saldoCentavos, 120000);
    assert.equal(resumen.tieneMovimientos, true);
    assert.deepEqual(resumen.categorias.map((categoria) => categoria.codigo), ["proveedores", "nomina"]);
  });

  it("cruza de año al mostrar doce meses", () => {
    const meses = mesesDelPeriodo("2026-11-05", 12);
    assert.equal(meses[0]?.clave, "2025-12");
    assert.equal(meses.at(-1)?.clave, "2026-11");
    assert.equal(periodoResumen("12"), 12);
    assert.equal(periodoResumen("cualquier-cosa"), 6);
  });

  it("una empresa sin asientos no inventa movimientos", () => {
    const vacio = armarResumenInicio({ saldoCentavos: 0, mensuales: [], categorias: [], recientes: [] }, "2026-11-05", 6);
    assert.equal(vacio.tieneMovimientos, false);
    assert.equal(vacio.ingresosMesCentavos, 0);
    assert.equal(vacio.gastosMesCentavos, 0);
    assert.equal(vacio.recientes.length, 0);
  });

  it("presenta la fecha en el horario de México", () => {
    assert.match(fechaMovimiento("2026-11-05T06:30:00.000Z"), /5 nov/);
    assert.match(fechaMovimiento("2026-11-05T06:30:00.000Z"), /00:30/);
  });
});
