"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { iniciarConContrasena } from "@/server/autenticacion";
import { aceptarInvitacion } from "@/server/invitaciones";
import { resolverDestinoInvitacion } from "@/server/invitaciones/destino";
import { ErrorDeDominio } from "@/server/session";
import { rechazoDeInvitacion, type EstadoInvitacion } from "./estado";

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
    // La contraseña se acaba de guardar: un rechazo aquí solo puede ser el tope de intentos.
    if (entrada.tipo === "rechazo") {
      return {
        tipo: "invalido",
        titulo: "La contraseña quedó guardada",
        mensaje: "Entra con tu correo para registrar el segundo factor.",
        deLaContrasena: false,
      };
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
      return rechazoDeInvitacion(error.codigo);
    }
    throw error;
  }
}
