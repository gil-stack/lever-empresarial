import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, rolesLeidos, superficieDe, tiene } from "./capacidades.ts";

describe("capacidades por superficie", () => {
  it("el tarjetahabiente puro no recibe consola ni tesorería", () => {
    const capacidades = capacidadesDe({ rolesCliente: ["tarjetahabiente"], rolesPlataforma: [] });
    assert.equal(capacidades.some((capacidad) => capacidad.startsWith("cliente.")), false);
    assert.equal(tiene(capacidades, "telefono.inicio.ver"), true);
    assert.equal(tiene(capacidades, "telefono.topes.ver"), true);
    assert.equal(tiene(capacidades, "telefono.facturacion.ver"), true);
    assert.equal(superficieDe("telefono.topes.ver"), "telefono");
  });

  it("el rol combinado conserva consola y teléfono", () => {
    const capacidades = capacidadesDe({ rolesCliente: ["administrador", "tarjetahabiente"], rolesPlataforma: [] });
    assert.equal(tiene(capacidades, "cliente.consola.ver"), true);
    assert.equal(tiene(capacidades, "telefono.inicio.ver"), true);
    assert.equal(tiene(capacidades, "cliente.poliza.ver"), true);
    assert.equal(tiene(capacidades, "cliente.plan.ver"), true);
  });

  it("solicitante sigue leyéndose en membresías históricas", () => {
    assert.deepEqual(rolesLeidos(["solicitante", "desconocido"]), ["solicitante"]);
  });
});
