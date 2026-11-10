import { notFound } from "next/navigation";

import { abrirRuta, errorConSecreto } from "@/server/entrada";
import type { PatronDeRuta } from "@/nucleo/rutas";
import type { ContextoDeTenant } from "@/nucleo/contexto";
import { ErrorDeDominio } from "@/server/session";

/**
 * Abre una página de cobranza y lee su vista. Sin permiso es 404; si la base
 * no responde, la vista llega vacía y la página dice que no pudo leer.
 */
export async function abrirCobranza<T>(patron: PatronDeRuta, leer: (ctx: ContextoDeTenant) => Promise<T>): Promise<{ ctx: ContextoDeTenant | null; vista: T | null }> {
  const apertura = await abrirRuta(patron);
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  if (apertura.tipo !== "abierta") return { ctx, vista: null };
  try {
    return { ctx, vista: await leer(apertura.ctx) };
  } catch (error) {
    if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
    return { ctx, vista: null };
  }
}
