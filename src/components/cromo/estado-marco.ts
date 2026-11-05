import "server-only";

import { cache } from "react";

import { empresaOperable } from "@/dominio/personas";
import { puede } from "@/nucleo/contexto";
import { contextoOpcional, errorConSecreto } from "@/server/entrada";
import { leerPendientesInicio } from "@/server/inicio/servicio";
import { resumenParaConsola } from "@/server/personas";
import { ErrorDeDominio } from "@/server/session";

import type { Contador } from "./secciones";

export type EmpresaDelMarco = { razonSocial: string; rfc: string };

export type EstadoDelMarco = {
  empresa: EmpresaDelMarco | null;
  contadores: Record<string, Contador>;
};

/** La barra lee la empresa y los liberadores que faltan, una vez por petición. */
export const estadoDelMarco = cache(async (): Promise<EstadoDelMarco> => {
  const ctx = await contextoOpcional();
  if (!ctx?.empresa) return { empresa: null, contadores: {} };
  const contadores: Record<string, Contador> = {};
  const [pendientes, faltan] = await Promise.all([
    puede(ctx, "cliente.consola.ver") ? pendientesQueFaltan(ctx) : 0,
    puede(ctx, "cliente.maestro.ver") ? liberadoresQueFaltan(ctx) : 0,
  ]);
  if (pendientes > 0) {
    contadores["/consola/pendientes"] = {
      valor: pendientes,
      etiqueta: pendientes === 1 ? "1 pendiente" : `${pendientes} pendientes`,
    };
  }
  if (faltan > 0) {
    contadores["/consola/personas"] = {
      valor: faltan,
      etiqueta: faltan === 1 ? "falta un liberador" : `faltan ${faltan} liberadores`,
    };
  }
  return {
    empresa: { razonSocial: ctx.empresa.razonSocial, rfc: ctx.empresa.rfc },
    contadores,
  };
});

async function pendientesQueFaltan(ctx: NonNullable<Awaited<ReturnType<typeof contextoOpcional>>>): Promise<number> {
  try {
    return (await leerPendientesInicio(ctx)).length;
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return 0;
    throw error;
  }
}

async function liberadoresQueFaltan(ctx: NonNullable<Awaited<ReturnType<typeof contextoOpcional>>>): Promise<number> {
  try {
    const cuentas = await resumenParaConsola(ctx);
    if (!cuentas) return 0;
    return empresaOperable(cuentas.nombres.length) ? 0 : Math.max(0, 2 - cuentas.nombres.length);
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return 0;
    throw error;
  }
}
