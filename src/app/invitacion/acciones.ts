"use server";

import { redirect } from "next/navigation";

import { fijarCookieDeSesion } from "@/server/entrada";
import { aceptarInvitacion } from "@/server/invitaciones";
import { ErrorDeDominio } from "@/server/session";
import type { EstadoAceptar } from "./estado";

const MENSAJES: Readonly<Record<string, { titulo: string; mensaje: string }>> = {
  contrasena_invalida: {
    titulo: "La contraseña no entra",
    mensaje: "Usa al menos 10 caracteres. Una frase larga funciona bien.",
  },
  contrasenas_distintas: {
    titulo: "No coinciden",
    mensaje: "Escribe la misma contraseña en los dos campos.",
  },
  credenciales_invalidas: {
    titulo: "La contraseña no coincide",
    mensaje: "Es la de tu cuenta de siempre. Si no la recuerdas, recupérala y vuelve a abrir este enlace.",
  },
  invitacion_vencida: {
    titulo: "La invitación venció",
    mensaje: "Pide a quien te invitó que la envíe de nuevo.",
  },
  invitacion_no_valida: {
    titulo: "El enlace ya no sirve",
    mensaje: "Se usó, se revocó o no existe. Pide una invitación nueva.",
  },
  correo_duplicado: {
    titulo: "El enlace ya se usó",
    mensaje: "Otra pestaña aceptó esta invitación. Entra con tu correo y tu contraseña.",
  },
  segunda_razon_social: {
    titulo: "Tu cuenta ya tiene empresa",
    mensaje: "Por ahora una persona entra a una sola empresa. Pide ayuda a quien te invitó.",
  },
  roles_combinados_pendientes: {
    titulo: "La invitación trae varios roles",
    mensaje: "Todavía no se pueden combinar. Pide que te inviten con uno.",
  },
};

export async function aceptar(_previo: EstadoAceptar, formData: FormData): Promise<EstadoAceptar> {
  let destino: string;
  try {
    const aceptada = await aceptarInvitacion({
      token: String(formData.get("token") ?? ""),
      contrasena: String(formData.get("contrasena") ?? ""),
      confirmacion: formData.has("confirmacion") ? String(formData.get("confirmacion")) : undefined,
    });
    if (!aceptada.siguiente) {
      return {
        tipo: "asentado",
        titulo: aceptada.cuentaNueva ? "Tu contraseña quedó guardada" : "Te sumaste a la empresa",
        mensaje: aceptada.cuentaNueva
          ? "Para entrar falta registrar tu segundo factor: una passkey o una app de códigos. Ese paso todavía no está disponible; nadie entra sin él."
          : "Entra con tu correo, tu contraseña y tu segundo factor.",
      };
    }
    await fijarCookieDeSesion(aceptada.siguiente.setCookie);
    destino = aceptada.siguiente.destino;
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      return {
        tipo: "invalido",
        ...(MENSAJES[error.codigo] ?? {
          titulo: "No se pudo aceptar",
          mensaje: "Vuelve a intentar en unos minutos.",
        }),
      };
    }
    throw error;
  }
  redirect(destino);
}
