import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, type RolCliente } from "../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../nucleo/contexto.ts";
import { leerPendientesInicio } from "../server/inicio/servicio.ts";
import { pendientesDeInicio, type DatosInicio } from "./inicio.ts";

const datos: DatosInicio = { centros: 0, personas: 0, liberadores: 1, categorias: 2, topesSinEscribir: 1, plan: "recorrido" };

describe("pendientes de la portada", () => {
  it("deriva acciones reales solo para quien puede abrirlas", () => {
    const admin = capacidadesDe({ rolesCliente: ["administrador"], rolesPlataforma: [] });
    const pendientes = pendientesDeInicio(datos, admin);
    assert.deepEqual(pendientes.map((pendiente) => pendiente.id), ["centro", "liberadores", "topes", "plan"]);
    assert.equal(pendientes.some((pendiente) => pendiente.id === "persona"), false);
    const contador = capacidadesDe({ rolesCliente: ["contador"], rolesPlataforma: [] });
    assert.deepEqual(pendientesDeInicio(datos, contador), []);
  });

  it("un tope cero ya está escrito y no aparece como pendiente", () => {
    const admin = capacidadesDe({ rolesCliente: ["administrador"], rolesPlataforma: [] });
    const completo: DatosInicio = { centros: 1, personas: 2, liberadores: 2, categorias: 1, topesSinEscribir: 0, plan: "aceptada" };
    assert.deepEqual(pendientesDeInicio(completo, admin), []);
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
