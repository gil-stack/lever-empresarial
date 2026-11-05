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
});
