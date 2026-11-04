"use server";

import { restablecerContrasena, solicitarRecuperacion } from "@/server/invitaciones";
import { ErrorDeDominio } from "@/server/session";
import type { EstadoRecuperar } from "./estado";

export async function pedirEnlace(_previo: EstadoRecuperar, formData: FormData): Promise<EstadoRecuperar> {
  try {
    await solicitarRecuperacion({ correo: String(formData.get("correo") ?? "") });
  } catch (error) {
    if (!(error instanceof ErrorDeDominio)) throw error;
    if (error.codigo === "correo_invalido") {
      return { tipo: "invalido", titulo: "Revisa el correo", mensaje: "Escribe el correo con el que entras." };
    }
    if (error.codigo === "correo_no_configurado") {
      return {
        tipo: "invalido",
        titulo: "El envío de correos no está disponible",
        mensaje: "Todavía no se puede recuperar la contraseña por correo. Pide ayuda a quien administra tu empresa.",
      };
    }
    return { tipo: "invalido", titulo: "No se pudo enviar", mensaje: "Intenta de nuevo en unos minutos." };
  }
  return {
    tipo: "asentado",
    titulo: "Revisa tu correo",
    mensaje:
      "Si ese correo tiene cuenta, te llegará un enlace en unos minutos. Sirve una sola vez y vence en una hora.",
  };
}

const MENSAJES: Readonly<Record<string, { titulo: string; mensaje: string }>> = {
  contrasena_invalida: {
    titulo: "La contraseña no entra",
    mensaje: "Usa al menos 10 caracteres. Una frase larga funciona bien.",
  },
  contrasenas_distintas: { titulo: "No coinciden", mensaje: "Escribe la misma contraseña en los dos campos." },
  recuperacion_vencida: { titulo: "El enlace venció", mensaje: "Pide uno nuevo desde «Recuperar contraseña»." },
  recuperacion_no_valida: {
    titulo: "El enlace ya no sirve",
    mensaje: "Se usó o se pidió otro después. Usa el más reciente o pide uno nuevo.",
  },
};

export async function guardarContrasena(_previo: EstadoRecuperar, formData: FormData): Promise<EstadoRecuperar> {
  try {
    await restablecerContrasena({
      token: String(formData.get("token") ?? ""),
      contrasena: String(formData.get("contrasena") ?? ""),
      confirmacion: String(formData.get("confirmacion") ?? ""),
    });
  } catch (error) {
    if (!(error instanceof ErrorDeDominio)) throw error;
    return {
      tipo: "invalido",
      ...(MENSAJES[error.codigo] ?? { titulo: "No se pudo guardar", mensaje: "Intenta de nuevo en unos minutos." }),
    };
  }
  return {
    tipo: "asentado",
    titulo: "Listo, tu contraseña cambió",
    mensaje:
      "Cerramos las sesiones que tenías abiertas. Entra con tu contraseña nueva y tu segundo factor, que no cambió.",
  };
}
