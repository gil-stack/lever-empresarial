"use server";

import { restablecerContrasena, solicitarRecuperacion } from "@/server/invitaciones/recuperar";
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
    mensaje: "Si ese correo tiene cuenta, te llegará un enlace. Sirve una sola vez, vence en una hora y no cambia tu segundo factor.",
  };
}

export async function guardarContrasena(_previo: EstadoRecuperar, formData: FormData): Promise<EstadoRecuperar> {
  try {
    await restablecerContrasena({
      token: String(formData.get("token") ?? ""),
      contrasena: String(formData.get("contrasena") ?? ""),
      confirmacion: String(formData.get("confirmacion") ?? ""),
    });
  } catch (error) {
    if (!(error instanceof ErrorDeDominio)) throw error;
    if (error.codigo === "contrasena_invalida") {
      return { tipo: "invalido", titulo: "La contraseña no entra", mensaje: "Usa al menos 10 caracteres." };
    }
    if (error.codigo === "contrasenas_distintas") {
      return { tipo: "invalido", titulo: "No coinciden", mensaje: "Escribe la misma contraseña en los dos campos." };
    }
    return {
      tipo: "invalido",
      titulo: "El enlace ya no sirve",
      mensaje: "Pide otro. Tu segundo factor no cambió.",
    };
  }
  return {
    tipo: "asentado",
    titulo: "La contraseña quedó guardada",
    mensaje: "Las sesiones anteriores se cerraron. Tu passkey y tu app autenticadora siguen. Entra con la contraseña nueva y el segundo factor.",
  };
}
