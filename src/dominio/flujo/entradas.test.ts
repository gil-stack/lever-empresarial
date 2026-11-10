import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validarCobroManual } from "./entradas.ts";

const COBRO = { clienteNombre: "Cliente Alfa", concepto: "Colegiaturas", monto: "100.00", fechaProbable: "2026-11-20", referencia: "" };

describe("RFC del cobro manual", () => {
  // bar-1: se guarda lo validado, sin guion ni espacio. base-N21: lo escrito que no queda en un RFC (solo
  // guiones o espacios) es error de su campo, no un RFC vacío que la base rechaza con «La base no respondió».
  it("guarda el RFC normalizado, avisa en su campo si lo escrito no es un RFC y el vacío queda sin RFC", () => {
    const conGuion = validarCobroManual({ ...COBRO, clienteRfc: "EKU900317-3C9" });
    assert.equal(conGuion.ok && conGuion.valor.clienteRfc, "EKU9003173C9");
    // serv-nuevo-1: en un identificador el control no se quita: es error de forma.
    for (const escrito of ["-", " - - ", "EKU900317-3C", "EKU900317\u00853C9"]) {
      const resultado = validarCobroManual({ ...COBRO, clienteRfc: escrito });
      assert.equal(resultado.ok, false, escrito);
      assert.deepEqual(!resultado.ok && resultado.errores.map((error) => error.campo), ["clienteRfc"], escrito);
    }
    const vacio = validarCobroManual({ ...COBRO, clienteRfc: "   " });
    assert.equal(vacio.ok && vacio.valor.clienteRfc, null);
  });
});
