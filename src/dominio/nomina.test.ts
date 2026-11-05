import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  disponibleParaPlaneacion,
  esDiaQuincena,
  mensualEstimado,
  siguientePago,
  validarConfiguracionNomina,
} from "./nomina.ts";

describe("calendario de nómina", () => {
  it("conserva el ancla mensual en meses cortos y años bisiestos", () => {
    assert.equal(siguientePago("2026-01-31", "mensual", 31), "2026-02-28");
    assert.equal(siguientePago("2026-02-28", "mensual", 31), "2026-03-31");
    assert.equal(siguientePago("2028-01-31", "mensual", 31), "2028-02-29");
    assert.equal(siguientePago("2026-01-30", "mensual", 30), "2026-02-28");
    assert.equal(siguientePago("2026-02-28", "mensual", 30), "2026-03-30");
  });

  it("usa 15 y último para quincenas y siete días para semanales", () => {
    assert.equal(siguientePago("2026-11-15", "quincenal"), "2026-11-30");
    assert.equal(siguientePago("2026-11-30", "quincenal"), "2026-12-15");
    assert.equal(siguientePago("2026-12-31", "quincenal"), "2027-01-15");
    assert.equal(siguientePago("2026-11-03", "semanal"), "2026-11-10");
    assert.equal(esDiaQuincena("2028-02-29"), true);
    assert.equal(esDiaQuincena("2026-11-16"), false);
  });

  it("exige neto, fecha válida y una quincena real", () => {
    const invalida = validarConfiguracionNomina(
      { neto: "0", frecuencia: "quincenal", primerPago: "2026-11-16", destino: "tarjeta" },
      "2026-11-03",
      "2026-11-03",
    );
    assert.equal(invalida.ok, false);
    if (!invalida.ok) {
      assert.ok(invalida.errores.some((error) => error.campo === "neto"));
      assert.ok(invalida.errores.some((error) => error.campo === "primerPago"));
    }
    const valida = validarConfiguracionNomina(
      { neto: "12,500.50", frecuencia: "quincenal", primerPago: "2026-11-15", destino: "tarjeta" },
      "2026-11-03",
      "2026-11-01",
    );
    assert.equal(valida.ok, true);
    if (valida.ok) assert.equal(valida.valor.netoCentavos, 1250050);
  });

  it("permite conservar una fecha vencida al editar, pero no elegir otra pasada", () => {
    const entrada = { neto: "100.00", frecuencia: "mensual", primerPago: "2026-11-04", destino: "tarjeta" } as const;
    const conservada = validarConfiguracionNomina(entrada, "2026-11-05", "2026-11-01", "2026-11-04");
    assert.equal(conservada.ok, true);
    const cambiada = validarConfiguracionNomina(entrada, "2026-11-05", "2026-11-01", "2026-11-03");
    assert.equal(cambiada.ok, false);
  });

  it("estima mensual sin flotantes y calcula disponible sin confundirlo con gasto", () => {
    assert.equal(mensualEstimado(10000, "semanal"), 43333);
    assert.equal(mensualEstimado(10000, "quincenal"), 20000);
    assert.equal(mensualEstimado(10000, "mensual"), 10000);
    assert.equal(disponibleParaPlaneacion(100000, 60000, 20000), 20000);
    assert.equal(disponibleParaPlaneacion(null, 60000, 20000), null);
  });
});
