import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import type { EstadoDelFormulario } from "../../app/operacion/rechazo.ts";
import { DecisionRecuperacion } from "./decision-recuperacion.tsx";

const pintar = () => renderToStaticMarkup(createElement(DecisionRecuperacion, { id: "r1", accion: async (previo: EstadoDelFormulario) => previo }));

// El error del servidor por tarjeta (el método o la nota, con lo escrito de vuelta) lo prueba la e2e «con tres
// recuperaciones pendientes…», con y sin JavaScript: desde la doceava revisión el aviso vuelve en el estado del formulario.
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

  it("sin rechazo no hay aviso, ni campo marcado, ni mensaje", () => {
    assert.doesNotMatch(pintar(), /error-campo|aria-invalid|operacion-aviso/);
  });
});
