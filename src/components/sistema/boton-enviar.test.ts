import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { BotonEnviar } from "./boton-enviar.tsx";

describe("botón de envío", () => {
  it("en reposo envía, con su texto y sin aria-busy", () => {
    const html = renderToStaticMarkup(createElement("form", null, createElement(BotonEnviar, null, "Guardar el plazo")));
    assert.match(html, /<button type="submit" class="boton">Guardar el plazo<\/button>/);
    assert.doesNotMatch(html, /disabled|aria-busy/);
  });

  it("mientras la acción corre se desactiva, anuncia que está ocupado y dice «Enviando…»", () => {
    const html = renderToStaticMarkup(createElement(BotonEnviar, { pendiente: true }, "Guardar el plazo"));
    assert.match(html, /disabled=""/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, />Enviando…<\/button>/);
    assert.doesNotMatch(html, /Guardar el plazo/);
  });

  it("acepta otro texto de espera, otra clase y los atributos del botón", () => {
    const html = renderToStaticMarkup(
      createElement(
        BotonEnviar,
        { pendiente: true, enviando: "Preparando…", className: "boton-texto boton-chico", name: "decision", value: "autorizar" },
        "Autorizar",
      ),
    );
    assert.match(html, /class="boton-texto boton-chico"/);
    assert.match(html, /name="decision"/);
    assert.match(html, /value="autorizar"/);
    assert.match(html, />Preparando…<\/button>/);
  });

  it("desactivado por la página no se anuncia como ocupado", () => {
    const html = renderToStaticMarkup(createElement(BotonEnviar, { disabled: true }, "Preparar nómina"));
    assert.match(html, /disabled=""/);
    assert.doesNotMatch(html, /aria-busy/);
    assert.match(html, />Preparar nómina<\/button>/);
  });
});
