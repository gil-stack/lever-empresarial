import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rutaSeccionOperacion, SECCIONES_OPERACION } from "../../src/components/operacion/secciones.ts";

describe("navegación del portal SOFIPO", () => {
  it("marca Resumen solo en la portada", () => {
    assert.equal(rutaSeccionOperacion(null), "/operacion");
  });

  it("conserva Clientes activo al abrir una ficha", () => {
    assert.equal(rutaSeccionOperacion("clientes"), "/operacion/clientes");
  });

  it("tiene una ruta para cada sección del menú", () => {
    for (const [ruta] of SECCIONES_OPERACION) {
      const segmento = ruta === "/operacion" ? null : ruta.slice("/operacion/".length);
      assert.equal(rutaSeccionOperacion(segmento), ruta);
    }
  });
});
