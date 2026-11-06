import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leerAcentoGuardado, valorAcentoGuardado } from "./acento-guardado";

const LAURA = "4f1c2d3e-0000-4000-8000-000000000001";

describe("acento guardado para el primer cuadro", () => {
  it("ida y vuelta: el servidor recupera el acento de la misma persona y tema", () => {
    const valor = valorAcentoGuardado(LAURA, "oscuro", "#E9DAC5", "#1A0705");
    assert.equal(valor, `${LAURA}.oscuro.E9DAC5.1A0705`);
    assert.deepEqual(leerAcentoGuardado(valor ?? undefined, LAURA, "oscuro"), { acento: "#E9DAC5", tinta: "#1A0705" });
  });

  it("no sirve para otra persona, otro tema o sin sesión", () => {
    const valor = valorAcentoGuardado(LAURA, "oscuro", "#E9DAC5", "#1A0705") ?? undefined;
    assert.equal(leerAcentoGuardado(valor, "otra-persona", "oscuro"), null);
    assert.equal(leerAcentoGuardado(valor, LAURA, "claro"), null);
    assert.equal(leerAcentoGuardado(valor, undefined, "oscuro"), null);
    assert.equal(leerAcentoGuardado(undefined, LAURA, "oscuro"), null);
  });

  it("rechaza lo que no sea un color hex (no se puede inyectar CSS)", () => {
    assert.equal(valorAcentoGuardado(LAURA, "oscuro", "red;}body{display:none", "#FFFFFF"), null);
    assert.equal(valorAcentoGuardado("x.y", "oscuro", "#E9DAC5", "#FFFFFF"), null);
    assert.equal(leerAcentoGuardado(`${LAURA}.oscuro.E9DAC5;}a{.FFFFFF`, LAURA, "oscuro"), null);
    assert.equal(leerAcentoGuardado(`${LAURA}.oscuro.E9DAC5`, LAURA, "oscuro"), null);
  });
});
