import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { relatoSinEmpresa } from "./relato.ts";

describe("la consola sin empresa", () => {
  it("no invita a dar de alta una empresa: la da de alta la SOFIPO", () => {
    const relato = relatoSinEmpresa(true);
    assert.match(relato.detalle, /SOFIPO/);
    assert.equal(relato.detalle.toLowerCase().includes("da de alta la razón social"), false);
  });

  it("si el libro no responde, no inventa que falta la razón social en el detalle", () => {
    const relato = relatoSinEmpresa(false);
    assert.equal(relato.detalle, "No se pudo consultar la cuenta.");
  });
});
