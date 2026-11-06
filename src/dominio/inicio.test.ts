import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, type RolCliente } from "../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../nucleo/contexto.ts";
import { leerPendientesInicio } from "../server/inicio/servicio.ts";
import { pendientesDeInicio, type DatosInicio } from "./inicio.ts";

const datos: DatosInicio = { centros: 0, personas: 0, liberadores: 1, categorias: 2, topesSinEscribir: 1, proveedores: 0, plan: "recorrido", pagosPorAutorizar: 0, nominaPorPreparar: null };

describe("pendientes de la portada", () => {
  it("deriva acciones reales solo para quien puede abrirlas", () => {
    const admin = capacidadesDe({ rolesCliente: ["administrador"], rolesPlataforma: [] });
    const pendientes = pendientesDeInicio(datos, admin);
    assert.deepEqual(pendientes.map((pendiente) => pendiente.id), ["liberadores", "centro", "topes", "proveedor", "plan"]);
    assert.equal(pendientes.some((pendiente) => pendiente.id === "persona"), false);
    const contador = capacidadesDe({ rolesCliente: ["contador"], rolesPlataforma: [] });
    assert.deepEqual(pendientesDeInicio(datos, contador), []);
  });

  it("un tope cero ya está escrito y no aparece como pendiente", () => {
    const admin = capacidadesDe({ rolesCliente: ["administrador"], rolesPlataforma: [] });
    const completo: DatosInicio = { centros: 1, personas: 2, liberadores: 2, categorias: 1, topesSinEscribir: 0, proveedores: 1, plan: "aceptada", pagosPorAutorizar: 0, nominaPorPreparar: null };
    assert.deepEqual(pendientesDeInicio(completo, admin), []);
  });

  it("pagos por autorizar y nómina por preparar solo para quien puede resolverlos", () => {
    const trabajo: DatosInicio = { centros: 1, personas: 2, liberadores: 2, categorias: 1, topesSinEscribir: 0, proveedores: 1, plan: "aceptada", pagosPorAutorizar: 3, nominaPorPreparar: "2026-11-15" };
    const ids = (roles: RolCliente[]) => pendientesDeInicio(trabajo, capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] })).map((pendiente) => pendiente.id);
    assert.deepEqual(ids(["liberador"]), ["pagos-por-autorizar", "nomina-por-preparar"]);
    assert.deepEqual(ids(["administrador"]), ["nomina-por-preparar"]);
    assert.deepEqual(ids(["contador"]), []);
    assert.deepEqual(ids(["solicitante"]), []);
    assert.deepEqual(ids(["finanzas", "tarjetahabiente"]), []);
    const [pago, nomina] = pendientesDeInicio(trabajo, capacidadesDe({ rolesCliente: ["liberador"], rolesPlataforma: [] }));
    assert.equal(pago?.titulo, "Autoriza 3 pagos a proveedores");
    assert.equal(pago?.ruta, "/consola/proveedores");
    assert.equal(nomina?.titulo, "Prepara el lote de nómina del 15 de noviembre");
    assert.equal(nomina?.ruta, "/consola/personas/nomina");
    const uno = pendientesDeInicio({ ...trabajo, pagosPorAutorizar: 1, nominaPorPreparar: null }, capacidadesDe({ rolesCliente: ["liberador"], rolesPlataforma: [] }));
    assert.deepEqual(uno.map((pendiente) => pendiente.titulo), ["Autoriza un pago a proveedor"]);
  });

  it("el liberador consulta la bandeja aunque no configure nada más", async () => {
    let consultas = 0;
    const pendientes = await leerPendientesInicio(ctx(["liberador"]), {
      ahora: () => new Date("2026-11-05T18:00:00Z"),
      repositorio: { async leer() { consultas += 1; return { ...datos, liberadores: 2, centros: 1, personas: 1, topesSinEscribir: 0, proveedores: 1, plan: "aceptada", pagosPorAutorizar: 2 }; } },
    });
    assert.equal(consultas, 1);
    assert.deepEqual(pendientes.map((pendiente) => pendiente.id), ["pagos-por-autorizar"]);
  });

  it("un rol sin acciones no consulta datos de configuración", async () => {
    let consultas = 0;
    const pendientes = await leerPendientesInicio(ctx(["contador"]), {
      repositorio: { async leer() { consultas += 1; return datos; } },
    });
    assert.deepEqual(pendientes, []);
    assert.equal(consultas, 0);
  });
});

function ctx(roles: RolCliente[]): ContextoDeTenant {
  const id = "11111111-1111-4111-8111-111111111111";
  return {
    sesionId: "33333333-3333-4333-8333-333333333333",
    peticionId: null,
    superficie: "cliente",
    persona: { id: "44444444-4444-4444-8444-444444444444", nombre: "Ada", correo: "ada@ejemplo.mx" },
    segundoFactor: "totp",
    empresa: { id, rfc: "EKU9003173C9", razonSocial: "Escuela", operadorId: "55555555-5555-4555-8555-555555555555", estado: "activa", demostracion: true },
    roles,
    personal: null,
    empresas: [{ id, razonSocial: "Escuela", roles }],
    capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}
