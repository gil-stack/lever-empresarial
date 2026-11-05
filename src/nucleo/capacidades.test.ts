import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, rolesLeidos, superficieDe, tiene, tieneRolDeTrabajo } from "./capacidades.ts";

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

  it("finanzas abre exactamente el resumen y pendientes: sin teléfono ni permisos operativos", () => {
    const capacidades = capacidadesDe({ rolesCliente: ["finanzas"], rolesPlataforma: [] });
    assert.deepEqual([...capacidades].sort(), ["cliente.consola.ver", "cliente.resumen.ver"]);
    for (const telefono of ["telefono.inicio.ver", "telefono.topes.ver", "telefono.facturacion.ver"] as const) {
      assert.equal(tiene(capacidades, telefono), false, telefono);
    }
  });

  it("finanzas no agrega teléfono a un rol de consola y no cuenta como rol de trabajo", () => {
    const contador = capacidadesDe({ rolesCliente: ["contador"], rolesPlataforma: [] });
    const conFinanzas = capacidadesDe({ rolesCliente: ["contador", "finanzas"], rolesPlataforma: [] });
    assert.deepEqual(
      conFinanzas.filter((capacidad) => !contador.includes(capacidad)),
      ["cliente.resumen.ver"],
    );
    assert.equal(tieneRolDeTrabajo(["finanzas"]), false);
    assert.equal(tieneRolDeTrabajo(["tarjetahabiente", "finanzas"]), true);
  });

  it("solicitante sigue leyéndose en membresías históricas", () => {
    assert.deepEqual(rolesLeidos(["solicitante", "desconocido"]), ["solicitante"]);
  });
});
