import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, ROLES_CLIENTE, rolesLeidos, superficieDe, tiene, tieneRolDeTrabajo, type RolCliente } from "./capacidades.ts";
import { rutaDe } from "./rutas.ts";

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

  it("finanzas abre exactamente el resumen, pendientes y el flujo: sin teléfono ni permisos operativos", () => {
    const capacidades = capacidadesDe({ rolesCliente: ["finanzas"], rolesPlataforma: [] });
    assert.deepEqual([...capacidades].sort(), [
      "cliente.consola.ver",
      "cliente.flujo.editar",
      "cliente.flujo.ver",
      "cliente.resumen.ver",
    ]);
    for (const telefono of ["telefono.inicio.ver", "telefono.topes.ver", "telefono.facturacion.ver"] as const) {
      assert.equal(tiene(capacidades, telefono), false, telefono);
    }
  });

  it("finanzas no agrega teléfono a un rol de consola y no cuenta como rol de trabajo", () => {
    const contador = capacidadesDe({ rolesCliente: ["contador"], rolesPlataforma: [] });
    const conFinanzas = capacidadesDe({ rolesCliente: ["contador", "finanzas"], rolesPlataforma: [] });
    assert.deepEqual(
      conFinanzas.filter((capacidad) => !contador.includes(capacidad)),
      ["cliente.resumen.ver", "cliente.flujo.editar"],
    );
    assert.equal(tieneRolDeTrabajo(["finanzas"]), false);
    assert.equal(tieneRolDeTrabajo(["tarjetahabiente", "finanzas"]), true);
  });

  it("el flujo de caja: administración y finanzas editan, contaduría solo lee, nadie más lo abre", () => {
    const de = (rol: Parameters<typeof capacidadesDe>[0]["rolesCliente"][number]) => capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] });
    for (const rol of ["administrador", "finanzas"] as const) {
      assert.equal(tiene(de(rol), "cliente.flujo.ver"), true, rol);
      assert.equal(tiene(de(rol), "cliente.flujo.editar"), true, rol);
    }
    assert.equal(tiene(de("contador"), "cliente.flujo.ver"), true);
    assert.equal(tiene(de("contador"), "cliente.flujo.editar"), false);
    for (const rol of ["solicitante", "liberador", "tarjetahabiente"] as const) {
      assert.equal(tiene(de(rol), "cliente.flujo.ver"), false, rol);
      assert.equal(tiene(de(rol), "cliente.flujo.editar"), false, rol);
    }
  });

  it("cada rol abre los módulos en demostración que dice el comentario de Finanzas", () => {
    const DEMO = ["conciliacion", "gastos", "tarjetas", "movimientos", "cuenta", "internacional", "credito", "inversion", "viajes", "gasolina", "ahorro", "integraciones"];
    const abre = (...roles: RolCliente[]) => {
      const capacidades = capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] });
      return DEMO.filter((modulo) => {
        const acceso = rutaDe(`/consola/${modulo}`)?.acceso;
        return acceso?.tipo === "capacidad" && acceso.alguna.some((capacidad) => tiene(capacidades, capacidad));
      });
    };
    assert.deepEqual(abre("administrador"), DEMO);
    assert.deepEqual(abre("tarjetahabiente", "finanzas"), ["gastos", "tarjetas", "movimientos", "cuenta", "credito", "inversion", "ahorro"]);
    assert.deepEqual(abre("contador"), ["conciliacion", "gastos", "movimientos", "internacional", "viajes", "gasolina", "ahorro"]);
    assert.deepEqual(abre("liberador"), ["internacional", "viajes", "gasolina"]);
    assert.deepEqual(abre("solicitante"), ["internacional", "viajes", "gasolina"]);
    assert.deepEqual(abre("tarjetahabiente"), []);
    const abreFiscal = (rol: RolCliente) => {
      const acceso = rutaDe("/consola/fiscal")?.acceso;
      const capacidades = capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] });
      return acceso?.tipo === "capacidad" && acceso.alguna.some((capacidad) => tiene(capacidades, capacidad));
    };
    assert.deepEqual(ROLES_CLIENTE.filter(abreFiscal), ["administrador", "solicitante", "liberador", "contador"]);
  });

  it("solicitante sigue leyéndose en membresías históricas", () => {
    assert.deepEqual(rolesLeidos(["solicitante", "desconocido"]), ["solicitante"]);
  });
});
