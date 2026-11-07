import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { FuentesFlujo } from "../../dominio/flujo/proyeccion.ts";
import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoConEmpresa, ContextoDeTenant } from "../../nucleo/contexto.ts";
import { leerFaltante } from "./servicio.ts";

/** Viernes 6 de noviembre de 2026 en México. */
const AHORA = () => new Date("2026-11-06T18:00:00.000Z");
const EMPRESA = "11111111-1111-4111-8111-111111111111";

function contexto(rol: RolCliente): ContextoDeTenant {
  return {
    sesionId: "55555555-5555-4555-8555-555555555555",
    peticionId: null,
    superficie: "cliente",
    persona: { id: "22222222-2222-4222-8222-222222222222", nombre: "Ana", correo: "ana@ejemplo.test" },
    segundoFactor: "totp",
    empresa: { id: EMPRESA, rfc: "EKU9003173C9", razonSocial: "Taller", operadorId: "66666666-6666-4666-8666-666666666666", estado: "activa", demostracion: false },
    roles: [rol],
    personal: null,
    empresas: [],
    capacidades: capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] }),
  };
}

/** Saldo de $20,000 y la nómina semanal de una sola persona ($18,500, viernes 13 y 20): la semana del 16 queda en negativo. */
function fuentes(saldoCentavos: number): FuentesFlujo {
  return {
    hoy: "2026-11-06",
    saldo: { centavos: saldoCentavos, alDia: "2026-11-06", autor: "Gil", declaradoEn: "2026-11-06T17:00:00.000Z" },
    colchonCentavos: 0,
    nomina: [{ netoCentavos: 1_850_000, frecuencia: "semanal", proximoPagoEn: "2026-11-13", anclaDia: 13, altaEn: "2026-11-06", bajaEn: null }],
    lotes: [],
    pagos: [],
    obligaciones: [],
    cobros: [],
    cobrados: [],
  };
}

/** Lector de fuentes que cuenta sus llamadas, en lugar de la base. */
function lector(saldoCentavos: number) {
  const llamadas: string[] = [];
  return {
    llamadas,
    fuentes: async (ctx: ContextoConEmpresa, hoy: string) => {
      llamadas.push(`${ctx.empresa.id} ${hoy}`);
      return fuentes(saldoCentavos);
    },
  };
}

describe("faltante en Pendientes", () => {
  it("con cliente.flujo.ver, Pendientes recibe el faltante que calcula la proyección de Inicio", async () => {
    const lectura = lector(2_000_000);
    const alerta = await leerFaltante(contexto("administrador"), { ahora: AHORA, fuentes: lectura.fuentes });
    assert.ok(alerta);
    assert.equal(alerta.faltante.motivo, "negativo");
    assert.equal(alerta.faltante.inicio, "2026-11-16");
    assert.equal(alerta.faltante.saldoFinal, 2_000_000 - 1_850_000 * 2);
    assert.equal(alerta.colchonCentavos, 0);
    assert.deepEqual(lectura.llamadas, [`${EMPRESA} 2026-11-06`]);
  });

  it("si el dinero alcanza no hay alerta", async () => {
    const alerta = await leerFaltante(contexto("administrador"), { ahora: AHORA, fuentes: lector(100_000_000).fuentes });
    assert.equal(alerta, null);
  });

  it("sin cliente.flujo.ver no se lee nada ni se recibe nada", async () => {
    for (const rol of ["liberador", "solicitante", "tarjetahabiente"] as const) {
      const lectura = lector(2_000_000);
      assert.equal(await leerFaltante(contexto(rol), { ahora: AHORA, fuentes: lectura.fuentes }), null, rol);
      assert.deepEqual(lectura.llamadas, [], rol);
    }
    assert.equal(await leerFaltante(null, { ahora: AHORA, fuentes: lector(2_000_000).fuentes }), null);
  });

  it("sin cliente.nomina.detalle.ver, las causas no dejan ver el neto de una sola persona", async () => {
    const conDetalle = await leerFaltante(contexto("administrador"), { ahora: AHORA, fuentes: lector(2_000_000).fuentes });
    const sinDetalle = await leerFaltante(contexto("contador"), { ahora: AHORA, fuentes: lector(2_000_000).fuentes });
    assert.ok(conDetalle && sinDetalle);
    assert.deepEqual(conDetalle.faltante.causas.map((m) => m.concepto), ["Nómina semanal (1 persona)"]);
    assert.deepEqual(sinDetalle.faltante.causas.map((m) => m.concepto), ["Nómina"]);
    assert.equal(JSON.stringify(sinDetalle).includes("1 persona"), false);
    // El saldo de la semana es el mismo: solo cambia el desglose.
    assert.equal(sinDetalle.faltante.saldoFinal, conDetalle.faltante.saldoFinal);
  });

  it("la página lee el faltante una vez por petición, junto con la bandeja", () => {
    const pagina = readFileSync(new URL("../../app/consola/pendientes/page.tsx", import.meta.url), "utf8");
    assert.match(pagina, /const faltanteDeLaPeticion = cache\(\(ctx: ContextoDeTenant\) => leerFaltante\(ctx\)\)/);
    assert.match(pagina, /Promise\.all\(\[bandejaDeLaPeticion\(apertura\.ctx\), faltanteDeLaPeticion\(apertura\.ctx\)\]\)/);
    assert.equal((pagina.match(/leerFaltante\(/g) ?? []).length, 1);
  });
});
