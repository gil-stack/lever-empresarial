import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const RAIZ = new URL("../../", import.meta.url);

describe("navegación lateral de la consola", () => {
  it("conserva el marco y la página actual mientras carga otra sección", () => {
    assert.equal(existsSync(new URL("src/app/consola/loading.tsx", RAIZ)), false, "El fallback global reemplaza toda la consola");
    const marco = readFileSync(new URL("src/components/cromo/marco.tsx", RAIZ), "utf8");
    const progreso = readFileSync(new URL("src/components/cromo/progreso-enlace.tsx", RAIZ), "utf8");
    assert.match(marco, /prefetch=\{true\}/);
    assert.match(progreso, /useLinkStatus/);
  });

  it("el teléfono no transmite un fallback antes de decidir si la página existe", () => {
    // Con loading.tsx la respuesta empieza a fluir con 200 y notFound() ya no puede responder 404.
    assert.equal(existsSync(new URL("src/app/telefono/loading.tsx", RAIZ)), false);
  });

  it("la página inexistente lleva la marca y no apunta a una ruta cerrada en producción", () => {
    assert.equal(existsSync(new URL("src/app/not-found.tsx", RAIZ)), true);
    const portada = readFileSync(new URL("src/app/page.tsx", RAIZ), "utf8");
    assert.doesNotMatch(portada, /href="\/muestrario"/);
  });
});
