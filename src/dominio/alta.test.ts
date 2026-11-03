import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ordenarErrores, validarAlta } from "./alta.ts";
import { regimenesVisibles, usosVisibles } from "./catalogos-fiscales.ts";
import { validarRfc } from "./rfc.ts";

const BASE = {
  rfc: "TCM010101AB1",
  razonSocial: "Taller Norte",
  codigoPostal: "06600",
  regimen: "601",
  usoCfdi: "G03",
  confirmaRecorte: true,
};

describe("la puerta usa el patrón de la fase", () => {
  it("acepta el RFC de prueba que el servicio ya dejaba pasar", () => {
    const { alta, errores } = validarAlta(BASE);
    assert.deepEqual(errores, []);
    assert.equal(alta.rfc, "TCM010101AB1");
    assert.equal(validarRfc("TCM010101AB1"), null);
    assert.equal(validarRfc("PAL7202311U0"), null);
  });

  it("rechaza 623, 610 y 605, y no los ofrece", () => {
    for (const regimen of ["623", "610", "605"]) {
      const errores = validarAlta({ ...BASE, regimen, usoCfdi: regimen === "605" ? "CN01" : "S01" }).errores;
      assert.equal(errores.some((error) => error.campo === "regimen"), true);
    }
    const visibles = regimenesVisibles(null).map((regimen) => regimen.codigo);
    assert.equal(visibles.includes("623"), false);
    assert.equal(visibles.includes("610"), false);
    assert.equal(visibles.includes("605"), false);
    assert.equal(usosVisibles("fisica", "612").some((uso) => uso.codigo === "CN01"), false);
    assert.equal(usosVisibles("fisica", "605").some((uso) => uso.codigo === "CN01"), false);
  });

  it("ordena los errores como la página, el nombre antes que el RFC", () => {
    const ordenados = ordenarErrores([
      { campo: "rfc", mensaje: "rfc" },
      { campo: "nombre", mensaje: "nombre" },
      { campo: "contrasena", mensaje: "contrasena" },
    ]);
    assert.deepEqual(
      ordenados.map((error) => error.campo),
      ["nombre", "contrasena", "rfc"],
    );
  });
});
