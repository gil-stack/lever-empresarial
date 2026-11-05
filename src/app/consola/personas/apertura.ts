import type { ContextoDeTenant } from "@/nucleo/contexto";
import type { PatronDeRuta } from "@/nucleo/rutas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";

export type AvisoPersonas = "libro" | "entrar" | "sin_empresa" | "no_abre" | "ausente";

export async function abrirPersonas(patron: PatronDeRuta): Promise<{
  ctx: ContextoDeTenant | null;
  ctxMarco: ContextoDeTenant | null;
  aviso: AvisoPersonas | null;
}> {
  const apertura = await abrirRuta(patron);
  if (apertura.tipo === "abierta") return { ctx: apertura.ctx, ctxMarco: apertura.ctx, aviso: null };
  return {
    ctx: null,
    ctxMarco: apertura.tipo === "libro" ? null : apertura.ctx,
    aviso: apertura.tipo === "libro" ? "libro" : apertura.tipo === "sin_empresa" ? "sin_empresa" : "no_abre",
  };
}

export function errorDePersonas(error: unknown): AvisoPersonas {
  if (error instanceof ErrorDeDominio) {
    if (error.codigo === "maestro_no_disponible") return "no_abre";
    if (error.codigo === "sin_empresa") return "sin_empresa";
    if (error.codigo === "sesion_ausente") return "entrar";
    if (error.codigo === "persona_ausente" || error.codigo === "lote_ausente") return "ausente";
    return "libro";
  }
  if (errorConSecreto(error)) return "libro";
  throw error;
}
