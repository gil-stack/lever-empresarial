import "server-only";

import { cache } from "react";

import { empresaOperable } from "@/dominio/personas";
import { puede } from "@/nucleo/contexto";
import { contextoOpcional, errorConSecreto } from "@/server/entrada";
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
  if (puede(ctx, "cliente.maestro.ver")) {
    const faltan = await liberadoresQueFaltan(ctx);
    if (faltan > 0) {
      contadores["/consola/personas"] = {
        valor: faltan,
        etiqueta: faltan === 1 ? "falta un liberador" : `faltan ${faltan} liberadores`,
      };
    }
  }
  return {
    empresa: { razonSocial: ctx.empresa.razonSocial, rfc: ctx.empresa.rfc },
    contadores,
  };
});

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
