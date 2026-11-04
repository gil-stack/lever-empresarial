"use server";

import { redirect } from "next/navigation";

import { RUTA_SEGUNDO_FACTOR } from "@/nucleo/rutas";
import { fijarCookieDeSesion } from "@/server/entrada";
import { aceptarInvitacion } from "@/server/invitaciones";
import { ErrorDeDominio } from "@/server/session";
import type { EstadoInvitacion } from "./estado";

const MENSAJES: Record<string, string> = {
  contrasena_invalida: "La contraseña necesita al menos 10 caracteres. Si es demasiado larga, elige otra.",
  contrasenas_distintas: "Las dos contraseñas no coinciden.",
  credenciales_invalidas: "Esa no es tu contraseña.",
  invitacion_usada: "Esta invitación ya se usó. Entra con tu correo.",
  invitacion_vencida: "Esta invitación venció. Pide otra a quien te invitó.",
  invitacion_revocada: "Esta invitación ya no sirve. Pide otra a quien te invitó.",
  invitacion_inexistente: "Este enlace no es una invitación.",
  invitacion_cerrada: "Esta invitación ya no sirve. Pide otra a quien te invitó.",
};

/** Acepta una sola vez y abre la sesión parcial: falta el segundo factor. */
export async function enviarAceptacion(_previo: EstadoInvitacion, formData: FormData): Promise<EstadoInvitacion> {
  try {
    const abierta = await aceptarInvitacion({
      token: formData.get("token"),
      contrasena: formData.get("contrasena"),
      confirmacion: formData.get("confirmacion"),
    });
    await fijarCookieDeSesion(abierta.setCookie);
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      return { tipo: "invalido", mensaje: MENSAJES[error.codigo] ?? "No se pudo aceptar. Vuelve a intentar." };
    }
    throw error;
  }
  redirect(RUTA_SEGUNDO_FACTOR);
}
