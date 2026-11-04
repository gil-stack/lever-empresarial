"use server";

import { redirect } from "next/navigation";

import { contextoDeAccion } from "@/server/entrada";
import { publicarSuscripcion } from "@/server/precio";
import { ErrorDeDominio } from "@/server/session";
import type { EstadoFormulario } from "./estado";

const MENSAJES: Record<string, string> = {
  sesion_ausente: "Hay que entrar como personal de la plataforma.",
  no_es_operador: "Solo el personal de la plataforma publica el monto.",
  monto_invalido: "Escribe el monto en pesos, con punto decimal y hasta dos centavos.",
  monto_en_cero: "La suscripción no se anuncia en cero.",
  precio_ya_publicado: "Ese monto ya está publicado.",
  precio_protegido: "Ese monto ya está publicado.",
  base_no_disponible: "No se pudo guardar. Vuelve a intentar.",
  base_no_configurada: "No se pudo guardar. Vuelve a intentar.",
};

/** La aceptación de una empresa la registra el comando del personal, no esta página. */
export async function enviarPublicacion(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const ctx = await contextoDeAccion();
  if (!ctx) return invalido("sesion_ausente");
  const crudo = formData.get("monto");
  const texto = typeof crudo === "string" ? crudo : "";
  if (texto.length > 32) return invalido("monto_invalido");
  try {
    await publicarSuscripcion(ctx, texto);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return invalido(error.codigo);
    throw error;
  }
  redirect("/precios");
}

function invalido(codigo: string): EstadoFormulario {
  return { tipo: "invalido", mensaje: MENSAJES[codigo] ?? "No se pudo guardar. Vuelve a intentar." };
}
