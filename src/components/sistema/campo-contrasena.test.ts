import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { CampoContrasena } from "./campo-contrasena.tsx";

describe("campo de contraseña", () => {
  it("empieza oculta y ofrece un control accesible para mostrarla", () => {
    const html = renderToStaticMarkup(createElement(CampoContrasena, {
      id: "contrasena",
      name: "contrasena",
      autoComplete: "current-password",
      required: true,
    }));
    assert.match(html, /type="password"/);
    assert.match(html, /name="contrasena"/);
    assert.match(html, /autoComplete="current-password"/);
    assert.match(html, /aria-label="Mostrar contraseña"/);
    assert.match(html, /aria-controls="contrasena"/);
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /type="button"/);
  });
});
