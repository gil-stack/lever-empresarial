import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoConEmpresa } from "../../nucleo/contexto.ts";
import { conexionIniciada } from "../../nucleo/db.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { VIGENCIA_AUTORIZACION_MS } from "../autenticacion/reautenticacion.ts";
import type { Sesion } from "../session/tipos.ts";
import { moverSaldoTarjeta, reintentarOperacionTarjeta } from "./index.ts";

const AHORA = new Date("2026-11-13T00:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const SESION = { id: ID, superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: AHORA } };
const deps = { ahora: () => AHORA, config: null };
type PruebaDeSesion = Pick<Sesion, "id" | "segundoFactor" | "superficie"> | null;

function contexto(rol: RolCliente): ContextoConEmpresa {
  return {
    sesionId: ID, peticionId: null, superficie: "cliente", segundoFactor: "totp",
    persona: { id: ID, nombre: "Ana", correo: "ana@ejemplo.test" },
    empresa: { id: ID, rfc: "TCM010101AB1", razonSocial: "Prueba", operadorId: ID, estado: "activa", demostracion: false },
    personal: null, empresas: [], roles: [rol], capacidades: capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] }),
  };
}

const invalidas: [string, PruebaDeSesion][] = [
  ["ausente", null],
  ["sin segundo factor", { ...SESION, segundoFactor: null }],
  ["de otra sesión", { ...SESION, id: "22222222-2222-4222-8222-222222222222" }],
  ["de otra superficie", { ...SESION, superficie: "sofipo" }],
  ["sin superficie", { ...SESION, superficie: undefined }],
  ["vencida por un milisegundo", { ...SESION, segundoFactor: { metodo: "totp", en: new Date(AHORA.getTime() - VIGENCIA_AUTORIZACION_MS - 1) } }],
  ["en el futuro", { ...SESION, segundoFactor: { metodo: "totp", en: new Date(AHORA.getTime() + 1) } }],
];

describe("Tarjetas: MFA de la misma sesión antes de mover fondos", () => {
  for (const rol of ["administrador", "liberador"] as const) {
    for (const tipo of ["carga", "retiro", "reintento"] as const) {
      for (const [nombre, sesion] of invalidas) {
        it(`${rol}: rechaza ${tipo} con prueba ${nombre} antes de abrir la base`, async () => {
          const operacion = tipo === "reintento"
            ? reintentarOperacionTarjeta(contexto(rol), sesion, ID, ID, deps)
            : moverSaldoTarjeta(contexto(rol), sesion, { tarjetaId: ID, tipo, centavos: 100, intento: ID }, deps);
          await assert.rejects(operacion, (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "reautenticacion_requerida");
          assert.equal(conexionIniciada(), false);
        });
      }
    }
  }

  it("una prueba reciente no concede el permiso de operar a finanzas", async () => {
    await assert.rejects(
      moverSaldoTarjeta(contexto("contador"), SESION, { tarjetaId: ID, tipo: "carga", centavos: 100, intento: ID }, deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
    assert.equal(conexionIniciada(), false);
  });
});
