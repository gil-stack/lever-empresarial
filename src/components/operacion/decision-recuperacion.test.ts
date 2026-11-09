import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { MensajeDelCampo } from "./aviso.tsx";
import { DecisionRecuperacion } from "./decision-recuperacion.tsx";

const pintar = (props: Partial<Parameters<typeof DecisionRecuperacion>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(DecisionRecuperacion, { id: "r1", accion: async () => {}, errorMetodo: {}, errorNota: {}, ...props }),
  );

describe("decisión de una recuperación", () => {
  it("el método arranca sin elegir y aprobar lo exige", () => {
    const html = pintar();
    assert.match(html, /<select[^>]*name="verificacion"[^>]*required/);
    assert.match(html, /<option value="" disabled="" selected="">Elige cómo verificaste<\/option>/);
    assert.doesNotMatch(html, /<option value="videollamada" selected/);
  });

  it("la nota es un área de texto: Enter no envía", () => {
    const html = pintar();
    assert.match(html, /<textarea[^>]*name="nota"/);
    assert.doesNotMatch(html, /<input[^>]*name="nota"/);
  });

  it("rechazar no pide método; aprobar sí pasa por la validación", () => {
    const html = pintar();
    assert.match(html, /<button[^>]*formNoValidate=""[^>]*value="rechazar"|<button[^>]*value="rechazar"[^>]*formNoValidate=""/);
    assert.doesNotMatch(html, /<button[^>]*value="aprobar"[^>]*formNoValidate/);
  });

  it("el error del servidor marca el campo que lo causó y pone su mensaje junto a él", () => {
    const marca = { "aria-invalid": true, "aria-describedby": "aviso-operacion-campo" } as const;
    const conNota = pintar({ errorNota: marca, mensajeNota: createElement(MensajeDelCampo, { codigo: "motivo_invalido", campo: "motivo" }) });
    assert.match(conNota, /<textarea[^>]*aria-invalid="true"[^>]*aria-describedby="aviso-operacion-campo"[^>]*><\/textarea><p id="aviso-operacion-campo" class="error-campo">Escribe un motivo breve y claro\.<\/p>/);
    assert.doesNotMatch(conNota, /<select[^>]*aria-invalid/);
    const conMetodo = pintar({ errorMetodo: marca, mensajeMetodo: createElement(MensajeDelCampo, { codigo: "verificacion_invalida", campo: "verificacion" }) });
    assert.match(conMetodo, /<select[^>]*aria-invalid="true"[^>]*aria-describedby="aviso-operacion-campo"[^>]*>.*<\/select><p id="aviso-operacion-campo" class="error-campo">/);
    assert.doesNotMatch(conMetodo, /<textarea[^>]*aria-invalid/);
    assert.doesNotMatch(pintar(), /error-campo/);
  });
});
