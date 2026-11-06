import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { BarraAvance, textoDeAvance } from "./cifras.tsx";

describe("barra de avance", () => {
  it("anuncia el porcentaje y, al pasarse del tope, que está excedido", () => {
    assert.equal(textoDeAvance(59, 100), "59 %");
    assert.equal(textoDeAvance(100, 100), "100 %");
    assert.equal(textoDeAvance(130, 100), "130 %, excedido");
    assert.equal(textoDeAvance(5, 0), "0 %");
  });

  it("el excedido llega al lector aunque aria-valuenow se tope", () => {
    const html = renderToStaticMarkup(createElement(BarraAvance, { valor: 6500, tope: 5000, etiqueta: "Gasto contra su tope" }));
    assert.match(html, /role="meter"/);
    assert.match(html, /aria-valuenow="5000"/);
    assert.match(html, /aria-valuetext="130 %, excedido"/);
    assert.match(html, /barra-avance-excedida/);
  });
});
