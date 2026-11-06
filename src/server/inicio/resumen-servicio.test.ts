import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatosResumenInicio } from "../../dominio/resumen.ts";
import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { leerResumenInicio } from "./resumen-servicio.ts";

const vacio: DatosResumenInicio = { saldoCentavos: 0, mensuales: [], categorias: [], recientes: [] };

describe("permiso del resumen financiero", () => {
  it("Finanzas consulta solo su periodo y recibe las cifras", async () => {
    let periodoRecibido = 0;
    const resumen = await leerResumenInicio(ctx(["contador", "finanzas"]), 12, {
      ahora: () => new Date("2026-11-05T15:00:00.000Z"),
      repositorio: { async leer(_ctx, hoy, periodo) { periodoRecibido = periodo; assert.equal(hoy, "2026-11-05"); return vacio; } },
    });
    assert.equal(periodoRecibido, 12);
    assert.equal(resumen.meses.length, 12);
  });

  it("un rol de consola sin Finanzas no consulta los movimientos", async () => {
    let consultas = 0;
    await assert.rejects(
      () => leerResumenInicio(ctx(["contador"]), 6, { repositorio: { async leer() { consultas += 1; return vacio; } } }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
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
