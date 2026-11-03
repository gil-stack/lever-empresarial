import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { relatoSinEmpresa } from "./relato.ts";

describe("la consola sin sesión", () => {
  it("no dice que esta cuenta no tiene razón social", () => {
    const relato = relatoSinEmpresa(true, false);
    const texto = `${relato.titulo} ${relato.detalle}`;
    assert.equal(texto.includes("Esta cuenta"), false);
    assert.equal(texto.includes("esta cuenta"), false);
    assert.equal(relato.titulo, "Hay que entrar.");
    assert.equal(relato.detalle, "La razón social se ve después de entrar.");
  });

  it("con sesión y sin empresa, sí habla de esta cuenta", () => {
    const relato = relatoSinEmpresa(true, true);
    assert.equal(relato.detalle, "Esta cuenta todavía no tiene razón social.");
  });

  it("si el libro no responde, no inventa que falta la razón social en el detalle", () => {
    const relato = relatoSinEmpresa(false, false);
    assert.equal(relato.detalle, "No se pudo consultar la cuenta.");
    assert.equal(relato.detalle.includes("Esta cuenta"), false);
  });
});