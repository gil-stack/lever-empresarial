import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe } from "../../nucleo/capacidades.ts";
import { capacidadesSegunEstado, empresaSuspendida, membresiaConRoles } from "./estado.ts";

describe("guardia del estado de la empresa", () => {
  it("solo activa y suspendida conservan los roles de la membresía", () => {
    assert.deepEqual(["activa", "suspendida", "prospecto", "en_alta", "baja", null].map(membresiaConRoles), [true, true, false, false, false, false]);
    assert.equal(empresaSuspendida({ estado: "suspendida" }), true);
    assert.equal(empresaSuspendida({ estado: "activa" }), false);
    assert.equal(empresaSuspendida(null), false);
  });

  it("filtra las mutaciones de una empresa suspendida sin alterar los permisos originales", () => {
    const originales = capacidadesDe({ rolesCliente: ["administrador", "liberador"], rolesPlataforma: [] });
    const copia = [...originales];
    const consultas = capacidadesSegunEstado("suspendida", originales);
    assert.ok(consultas.length > 0);
    assert.ok(consultas.every((capacidad) => capacidad.endsWith(".ver")));
    assert.ok(consultas.includes("cliente.maestro.ver"));
    for (const capacidad of ["cliente.personas.clabe.cambiar", "cliente.proveedores.alta", "cliente.pago.solicitar"] as const) {
      assert.ok(originales.includes(capacidad));
      assert.equal(consultas.includes(capacidad), false);
    }
    assert.deepEqual(originales, copia);
  });

  it("conserva las capacidades de una empresa activa y del personal sin empresa elegida", () => {
    const originales = capacidadesDe({ rolesCliente: ["administrador"], rolesPlataforma: ["administracion_plataforma"] });
    for (const estado of ["activa", null, undefined]) {
      const resultado = capacidadesSegunEstado(estado, originales);
      assert.deepEqual(resultado, originales);
      assert.notEqual(resultado, originales);
    }
  });
});
