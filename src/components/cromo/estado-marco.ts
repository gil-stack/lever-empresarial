import "server-only";

import { cache } from "react";

import { empresaOperable, puedeVerMaestro } from "@/dominio/personas";
import { errorConSecreto, leerEntrada, sesionSegura } from "@/server/entrada";
import { resumenParaConsola } from "@/server/personas";
import { ErrorDeDominio } from "@/server/session";

import type { Contador } from "./secciones";

export type EmpresaDelMarco = { razonSocial: string; rfc: string };

export type EstadoDelMarco = {
  empresa: EmpresaDelMarco | null;
  contadores: Record<string, Contador>;
};

/**
 * Lo que la barra lateral dice de la sesión: la empresa y los pendientes reales.
 * Se lee una vez por petición, en cualquier página que use el marco.
 */
export const estadoDelMarco = cache(async (): Promise<EstadoDelMarco> => {
  const entrada = await leerEntrada();
  const empresa =
    entrada.rfc && entrada.razonSocial ? { razonSocial: entrada.razonSocial, rfc: entrada.rfc } : null;
  const contadores: Record<string, Contador> = {};
  if (empresa && puedeVerMaestro(entrada.rol)) {
    const faltan = await liberadoresQueFaltan();
    if (faltan > 0) {
      contadores["/consola/personas"] = {
        valor: faltan,
        etiqueta: faltan === 1 ? "falta un liberador" : `faltan ${faltan} liberadores`,
      };
    }
  }
  return { empresa, contadores };
});

async function liberadoresQueFaltan(): Promise<number> {
  try {
    const cuentas = await resumenParaConsola(await sesionSegura());
    if (!cuentas) return 0;
    const autorizados = cuentas.nombres.length;
    return empresaOperable(autorizados) ? 0 : 2 - autorizados;
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return 0;
    throw error;
  }
}
