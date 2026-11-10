import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deCatalogo } from "./catalogo.ts";

describe("catálogo con una clave de fuera", () => {
  const AVISOS: Record<string, string> = { entrada_vencida: "La entrada venció. Vuelve a empezar." };

  it("devuelve lo que el catálogo trae para sus propias claves", () => {
    assert.equal(deCatalogo(AVISOS, "entrada_vencida"), "La entrada venció. Vuelve a empezar.");
  });

  it("lo heredado de Object.prototype no es del catálogo (doce-N2: `?aviso=constructor` daba 500)", () => {
    for (const clave of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "isPrototypeOf"]) {
      assert.equal(deCatalogo(AVISOS, clave), null, clave);
    }
  });

  it("sin clave, o con una que no es texto, no hay nada", () => {
    for (const clave of [undefined, null, ""]) assert.equal(deCatalogo(AVISOS, clave), null, String(clave));
  });
});
