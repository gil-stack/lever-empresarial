import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { esVisible } from "./visible";

type Doble = { checkVisibility?: (opciones: unknown) => boolean; getClientRects: () => { length: number }; visibility: string };

function elemento(doble: Doble): HTMLElement {
  return doble as unknown as HTMLElement;
}

const original = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;

describe("visibilidad de lo enfocable en el cajón", () => {
  afterEach(() => {
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = original;
  });

  it("usa checkVisibility cuando el navegador lo tiene", () => {
    const pedidas: unknown[] = [];
    const visto = esVisible(
      elemento({
        checkVisibility: (opciones) => {
          pedidas.push(opciones);
          return false;
        },
        getClientRects: () => ({ length: 1 }),
        visibility: "visible",
      }),
    );
    assert.equal(visto, false);
    assert.deepEqual(pedidas, [{ visibilityProperty: true }]);
  });

  it("sin checkVisibility (Safari anterior a 17.4) no lanza y decide por la caja y la visibilidad", () => {
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = (e: Doble) => ({ visibility: e.visibility });
    assert.equal(esVisible(elemento({ getClientRects: () => ({ length: 1 }), visibility: "visible" })), true);
    assert.equal(esVisible(elemento({ getClientRects: () => ({ length: 1 }), visibility: "hidden" })), false);
    assert.equal(esVisible(elemento({ getClientRects: () => ({ length: 0 }), visibility: "visible" })), false);
  });
});
