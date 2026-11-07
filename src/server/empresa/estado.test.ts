import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CAPACIDADES, capacidadesDe } from "../../nucleo/capacidades.ts";
import { capacidadesSegunEstado, empresaSuspendida, membresiaConRoles } from "./estado.ts";

describe("guardia del estado de la empresa", () => {
  it("una empresa suspendida conserva solo las capacidades de consulta", () => {
    const todas = capacidadesDe({ rolesCliente: ["administrador", "liberador"], rolesPlataforma: [] });
    const lectura = capacidadesSegunEstado("suspendida", todas);
    assert.ok(lectura.length > 0);
    assert.ok(lectura.every((capacidad) => capacidad.endsWith(".ver")));
    for (const escritura of ["cliente.pago.liberar", "cliente.pago.solicitar", "cliente.maestro.editar", "cliente.flujo.editar", "cliente.membresias.administrar"] as const) {
      assert.ok(todas.includes(escritura), escritura);
      assert.ok(!lectura.includes(escritura), escritura);
    }
    assert.ok(lectura.includes("cliente.consola.ver"));
  });

  it("activa no cambia nada y cada capacidad de escritura deja de valer al suspender", () => {
    assert.deepEqual(capacidadesSegunEstado("activa", CAPACIDADES), [...CAPACIDADES]);
    const sinVer = CAPACIDADES.filter((capacidad) => !capacidad.endsWith(".ver"));
    assert.deepEqual(capacidadesSegunEstado("suspendida", sinVer), []);
  });

  it("solo activa y suspendida conservan los roles de la membresía", () => {
    assert.deepEqual(["activa", "suspendida", "prospecto", "en_alta", "baja", null].map(membresiaConRoles), [true, true, false, false, false, false]);
    assert.equal(empresaSuspendida({ estado: "suspendida" }), true);
    assert.equal(empresaSuspendida({ estado: "activa" }), false);
    assert.equal(empresaSuspendida(null), false);
  });
});
