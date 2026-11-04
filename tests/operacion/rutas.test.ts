import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rutaDe } from "../../src/nucleo/rutas.ts";

const PROTEGIDAS = [
  "/operacion",
  "/operacion/clientes",
  "/operacion/clientes/123",
  "/operacion/aprobaciones",
  "/operacion/alertas",
  "/operacion/comisiones",
  "/operacion/bitacora",
] as const;

describe("guardia central del portal SOFIPO", () => {
  it("exige sesión completa en todas las rutas del portal", () => {
    for (const patron of PROTEGIDAS) {
      const ruta = rutaDe(patron);
      assert.equal(ruta?.superficie, "sofipo");
      assert.equal(ruta?.acceso.tipo, "sesion", patron);
    }
  });

  it("deja la entrada pública y el segundo factor acotado a su cookie", () => {
    assert.equal(rutaDe("/operacion/entrar")?.acceso.tipo, "publica");
    assert.equal(rutaDe("/operacion/continuar")?.acceso.tipo, "segundo_factor");
  });
});
