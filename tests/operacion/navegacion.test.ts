import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

  it("conserva la página actual y limita el progreso al enlace pendiente", () => {
    const fallbackGlobal = new URL("../../src/app/operacion/(portal)/loading.tsx", import.meta.url);
    const navegacion = readFileSync(new URL("../../src/components/operacion/navegacion.tsx", import.meta.url), "utf8");
    const progreso = readFileSync(new URL("../../src/components/cromo/progreso-enlace.tsx", import.meta.url), "utf8");
    assert.equal(existsSync(fallbackGlobal), false, "El fallback global reemplaza toda la página durante la navegación");
    // Cada enlace lleva su propio indicador: el mismo de la consola, que lee useLinkStatus.
    assert.match(navegacion, /<ProgresoEnlace \/>/);
    assert.match(progreso, /useLinkStatus/);
  });
});
