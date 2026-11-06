import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { capacidadesDe } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { traducirErrorDeBase } from "../../nucleo/db.ts";
import type { RepositorioPrecios } from "./repositorio.ts";
import { aceptarSuscripcion, leerTarifa, publicarSuscripcion } from "./servicio.ts";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const PERSONA = "22222222-2222-4222-8222-222222222222";
const FILA = "33333333-3333-4333-8333-333333333333";
const AHORA = new Date("2026-11-06T12:00:00.000Z");
const SOFIPO_RECIENTE = { superficie: "sofipo" as const, segundoFactor: { metodo: "totp" as const, en: AHORA } };

describe("el precio es de la plataforma", () => {
  it("vacío no se disfraza de cifra, y un cliente no lo publica", async () => {
    const libro = memoria();
    const tarifa = await leerTarifa({ repositorio: libro });
    assert.equal(tarifa.suscripcionPublicada, false);
    await assert.rejects(
      () => publicarSuscripcion(cliente(), SOFIPO_RECIENTE, "100.00", { repositorio: libro, ahora: () => AHORA }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "no_es_operador",
    );
    assert.equal(libro.centavos, null);
  });

  it("el personal publica centavos una vez y acepta la suscripción de la empresa que nombra", async () => {
    const libro = memoria();
    const publicada = await publicarSuscripcion(personal(), SOFIPO_RECIENTE, "100.50", {
      repositorio: libro,
      ahora: () => AHORA,
    });
    assert.equal(publicada.suscripcionPublicada, true);
    assert.match(publicada.suscripcion, /100\.50|100,50/);
    await assert.rejects(
      () => publicarSuscripcion(personal(), SOFIPO_RECIENTE, "20", { repositorio: libro, ahora: () => AHORA }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "precio_ya_publicado",
    );
    await aceptarSuscripcion(personal(), { companyId: EMPRESA }, { repositorio: libro });
    assert.equal(libro.aceptada, EMPRESA);
  });

  it("publicar exige un segundo factor SOFIPO de los últimos 30 minutos", async () => {
    const libro = memoria();
    const viejo = { superficie: "sofipo" as const, segundoFactor: { metodo: "totp" as const, en: new Date(AHORA.getTime() - 31 * 60_000) } };
    const deCliente = { superficie: "cliente" as const, segundoFactor: { metodo: "totp" as const, en: AHORA } };
    for (const sesion of [viejo, deCliente, null]) {
      await assert.rejects(
        () => publicarSuscripcion(personal(), sesion, "100.00", { repositorio: libro, ahora: () => AHORA }),
        (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "reautenticacion_requerida",
      );
    }
    assert.equal(libro.centavos, null);
  });

  it("la migración no siembra un monto y el trigger no se copia al mensaje", () => {
    const sql = readFileSync(new URL("../../../db/migrations/0009_platform_pricing.sql", import.meta.url), "utf8");
    assert.match(sql, /NULL, NULL/);
    assert.doesNotMatch(sql, /insert into platform_pricing[^;]*[1-9]/i);
    const traducido = traducirErrorDeBase(
      Object.assign(new Error("el monto de la suscripcion ya esta publicado"), { code: "P0001" }),
    );
    assert.equal(traducido instanceof ErrorDeDominio && traducido.codigo, "precio_ya_publicado");
    const conSecreto = traducirErrorDeBase(new Error("password authentication failed postgres://secreto@host/db"));
    assert.equal((conSecreto as Error).message.includes("secreto"), false);
  });
});

function cliente(): ContextoDeTenant {
  return contexto(false);
}

function personal(): ContextoDeTenant {
  return contexto(true);
}

function contexto(esPersonal: boolean): ContextoDeTenant {
  return {
    sesionId: "55555555-5555-4555-8555-555555555555",
    peticionId: null,
    superficie: esPersonal ? "sofipo" : "cliente",
    persona: { id: PERSONA, nombre: "Ana", correo: "ana@ejemplo.mx" },
    segundoFactor: esPersonal ? "comando" : "totp",
    empresa: esPersonal
      ? null
      : {
          id: EMPRESA,
          rfc: "EKU9003173C9",
          razonSocial: "Escuela",
          operadorId: "44444444-4444-4444-8444-444444444444",
          estado: "activa",
          demostracion: true,
        },
    roles: esPersonal ? [] : ["administrador"],
    personal: esPersonal
      ? { operadorId: "44444444-4444-4444-8444-444444444444", roles: ["administracion_plataforma"] }
      : null,
    empresas: [],
    capacidades: capacidadesDe({
      rolesCliente: esPersonal ? [] : ["administrador"],
      rolesPlataforma: esPersonal ? ["administracion_plataforma"] : [],
    }),
  };
}

function memoria(): RepositorioPrecios & { centavos: bigint | null; aceptada: string | null } {
  const estado = { centavos: null as bigint | null, aceptada: null as string | null };
  return {
    ...estado,
    get centavos() {
      return estado.centavos;
    },
    get aceptada() {
      return estado.aceptada;
    },
    async leerPrecio() {
      return {
        filaId: FILA,
        centavos: estado.centavos,
        publicadoEn: estado.centavos === null ? null : new Date("2026-11-04T00:00:00.000Z"),
      };
    },
    async publicar(_ctx, entrada) {
      if (estado.centavos !== null) throw new ErrorDeDominio("precio_ya_publicado");
      estado.centavos = entrada.centavos;
      return { filaId: FILA, centavos: entrada.centavos, publicadoEn: entrada.cuando };
    },
    async leerSuscripcion() {
      return null;
    },
    async aceptar(_ctx, entrada) {
      estado.aceptada = entrada.companyId;
      return {
        companyId: entrada.companyId,
        estado: "aceptada",
        recorridoInicio: entrada.cuando,
        aceptadaEn: entrada.cuando,
        aceptadaPorNombre: "Ana",
      };
    },
  };
}
