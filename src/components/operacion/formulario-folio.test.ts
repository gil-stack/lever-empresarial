import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import type { EstadoDelFormulario } from "../../app/operacion/rechazo.ts";
import { errorDelCampo } from "./aviso.tsx";
import { FormularioFolio } from "./formulario-folio.tsx";

const ID = "11111111-1111-4111-8111-111111111111";
const pintar = () => renderToStaticMarkup(createElement(FormularioFolio, { id: ID, desde: "cumplimiento", accion: async (previo: EstadoDelFormulario) => previo }));
const CAMPOS = ["folio", "presentadoEl", "avisoClienteEl"] as const;

// serv-nuevo-6b: con una fecha que no existe (2026-02-30 o 2026-13-01), la pantalla decía «Revisa el campo marcado»
// sin marcar nada y el foco quedaba en la página. Cada rechazo es de un campo del formulario, por su nombre; desde la
// doceava revisión el aviso vuelve en el estado del formulario de esa coincidencia (la e2e lo prueba con y sin JavaScript).
describe("el formulario del folio marca el campo que falló", () => {
  it("la fecha de presentación, la del aviso y el folio: cada rechazo marca un solo campo, el suyo", () => {
    const html = pintar();
    for (const campo of CAMPOS) assert.match(html, new RegExp(`name="${campo}"`), campo);
    for (const [codigo, campo] of [["dato_invalido_presentadoEl", "presentadoEl"], ["dato_invalido_avisoClienteEl", "avisoClienteEl"], ["invisible_folio", "folio"], ["dato_invalido_folio", "folio"]] as const) {
      for (const nombre of CAMPOS) assert.equal(errorDelCampo(codigo, nombre)["aria-invalid"] === true, nombre === campo, `${codigo}: ${nombre}`);
    }
  });

  it("sin rechazo no se marca nada", () => {
    assert.doesNotMatch(pintar(), /aria-invalid|error-campo/);
  });
});
