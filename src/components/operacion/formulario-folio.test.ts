import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { FormularioFolio } from "./formulario-folio.tsx";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const CAMPOS = ["folio", "presentado", "aviso"] as const;
const pintar = (id: string, aviso: string, en: string) =>
  renderToStaticMarkup(createElement(FormularioFolio, { id, desde: "cumplimiento", accion: async () => {}, aviso, en }));
// Onceava revisión: el campo marcado lleva justo después su mensaje, que es su descripción.
const marcado = (html: string, id: string) =>
  new RegExp(`<input[^>]*id="${id}"[^>]*aria-invalid="true"[^>]*aria-describedby="aviso-operacion-campo"[^>]*/><p id="aviso-operacion-campo" class="error-campo">`).test(html);

// serv-nuevo-6b: con una fecha que no existe (2026-02-30 o 2026-13-01), la pantalla decía «Revisa el campo marcado»
// sin marcar nada y el foco quedaba en la página. Ahora cada fecha marca su campo, solo en la coincidencia enviada.
describe("el formulario del folio marca el campo que falló", () => {
  it("la fecha de presentación, la del aviso y el folio, cada uno en su campo", () => {
    for (const [codigo, campo] of [["dato_invalido_presentadoEl", "presentado"], ["dato_invalido_avisoClienteEl", "aviso"], ["invisible_folio", "folio"]] as const) {
      const html = pintar(ID, codigo, `${campo}-${ID}`);
      for (const nombre of CAMPOS) assert.equal(marcado(html, `${nombre}-${ID}`), nombre === campo, `${codigo}: ${nombre}`);
    }
  });

  it("en otra coincidencia, o sin el campo en la dirección, no se marca nada", () => {
    assert.doesNotMatch(pintar(OTRA, "dato_invalido_presentadoEl", `presentado-${ID}`), /aria-invalid|error-campo/);
    assert.doesNotMatch(pintar(ID, "dato_invalido_presentadoEl", ""), /aria-invalid|error-campo/);
  });
});
