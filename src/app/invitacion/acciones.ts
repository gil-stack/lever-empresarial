"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { iniciarConContrasena } from "@/server/autenticacion";
import { aceptarInvitacion } from "@/server/invitaciones";
import { resolverDestinoInvitacion } from "@/server/invitaciones/destino";
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

/** Guarda la contraseña y lleva a registrar o verificar el segundo factor. No abre el portal. */
export async function enviarAceptacion(_previo: EstadoInvitacion, formData: FormData): Promise<EstadoInvitacion> {
  const contrasena = String(formData.get("contrasena") ?? "");
  try {
    const aceptada = await aceptarInvitacion({
      token: formData.get("token"),
      contrasena,
      confirmacion: formData.get("confirmacion"),
    });
    const destino = resolverDestinoInvitacion(aceptada.companyId);
    const entrada = await iniciarConContrasena({ correo: aceptada.correo, contrasena }, { superficie: destino.superficie });
    if (entrada.tipo === "rechazo") {
      return { tipo: "invalido", mensaje: MENSAJES[entrada.codigo] ?? "La contraseña quedó guardada. Entra para registrar el segundo factor." };
    }
    const jar = await cookies();
    jar.set(destino.cookieEntrada, entrada.cookie.valor, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: entrada.cookie.maxAge,
    });
    redirect(destino.ruta);
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      return { tipo: "invalido", mensaje: MENSAJES[error.codigo] ?? "No se pudo aceptar. Vuelve a intentar." };
    }
    throw error;
  }
}
