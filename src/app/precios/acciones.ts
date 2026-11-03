"use server";

import { redirect } from "next/navigation";

import { sesionDesdeCookie } from "@/server/entrada";
import { aceptarSuscripcion, publicarSuscripcion } from "@/server/precio";
import { ErrorDeDominio } from "@/server/session";
import type { Sesion } from "@/server/session";
import type { EstadoFormulario } from "./estado";

const MENSAJES: Record<string, string> = {
  sesion_ausente: "Hay que entrar como operador de la plataforma.",
  no_es_operador: "Solo el operador de la plataforma puede hacer este registro.",
  monto_invalido: "Escribe el monto en pesos, con punto decimal y hasta dos centavos.",
  monto_en_cero: "La suscripción no se anuncia en cero.",
  precio_ya_publicado: "Ese monto ya está publicado.",
  precio_no_publicado: "Aceptar la suscripción espera a que el monto esté publicado.",
  suscripcion_ya_aceptada: "Esta suscripción ya está aceptada.",
  suscripcion_ausente: "Esta empresa no tiene suscripción.",
  empresa_ausente: "Esta sesión no tiene una razón social.",
  base_no_disponible: "No se pudo guardar. Vuelve a intentar.",
  base_no_configurada: "No se pudo guardar. Vuelve a intentar.",
  precio_protegido: "Ese monto ya está publicado.",
  suscripcion_protegida: "La suscripción no se puede reescribir.",
  suscripcion_invalida: "No se pudo registrar la aceptación.",
};

export async function enviarPublicacion(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const sesion = await leerSesionDeFormulario();
  if (sesion instanceof ErrorDeDominio) return invalido(sesion.codigo);
  const crudo = formData.get("monto");
  const texto = typeof crudo === "string" ? crudo : "";
  if (texto.length > 32) return invalido("monto_invalido");
  try {
    await publicarSuscripcion(sesion, texto);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return invalido(error.codigo);
    throw error;
  }
  redirect("/precios");
}

export async function enviarAceptacion(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  if (String(formData.get("clienteAcepto") ?? "") !== "si") {
    return {
      tipo: "invalido",
      mensaje: "Hace falta registrar que el cliente aceptó el monto.",
    };
  }
  const sesion = await leerSesionDeFormulario();
  if (sesion instanceof ErrorDeDominio) return invalido(sesion.codigo);
  try {
    await aceptarSuscripcion(sesion);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return invalido(error.codigo);
    throw error;
  }
  redirect("/consola");
}

async function leerSesionDeFormulario(): Promise<Sesion | null | ErrorDeDominio> {
  try {
    return await sesionDesdeCookie();
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error;
    throw error;
  }
}

function invalido(codigo: string): EstadoFormulario {
  return { tipo: "invalido", mensaje: MENSAJES[codigo] ?? "No se pudo guardar. Vuelve a intentar." };
}
