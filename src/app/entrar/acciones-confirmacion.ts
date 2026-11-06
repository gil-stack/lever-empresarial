"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  confirmarConPasskey,
  confirmarConRespaldo,
  confirmarConTotp,
  dominiosDesdeEntorno,
  opcionesParaConfirmarConPasskey,
  origenDe,
} from "@/server/autenticacion";
import { sesionDesdeCookie } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";
import type { Sesion } from "@/server/session/tipos";

import type { EstadoConfirmacion } from "./estado-confirmacion";

/**
 * Confirmar la identidad dentro de una sesión abierta, con el mismo factor que
 * abre la puerta. Sirve a las dos superficies: cada sesión renueva su propio
 * segundo factor. Al quinto intento fallido la sesión se cierra.
 */

const MENSAJES: Record<string, string> = {
  segundo_factor_invalido: "Ese código no coincide. Vuelve a intentar.",
  passkey_ausente: "No hay una passkey registrada en esta cuenta.",
  totp_no_disponible: "La app autenticadora no está disponible. Usa una passkey o un código de respaldo.",
  origen_no_permitido: "Esta dirección no puede usar passkeys.",
  segundo_factor_ausente: "Entra de nuevo con tu segundo factor.",
  sesion_ausente: "Tu sesión terminó. Entra de nuevo.",
};

export async function confirmarIdentidadConTotp(
  _previo: EstadoConfirmacion,
  formData: FormData,
): Promise<EstadoConfirmacion> {
  const sesion = await exigirSesion();
  try {
    await confirmarConTotp(sesion, formData.get("codigo"));
  } catch (error) {
    return fallo(error, sesion);
  }
  return { tipo: "confirmada" };
}

export async function confirmarIdentidadConRespaldo(
  _previo: EstadoConfirmacion,
  formData: FormData,
): Promise<EstadoConfirmacion> {
  const sesion = await exigirSesion();
  try {
    await confirmarConRespaldo(sesion, formData.get("codigo"));
  } catch (error) {
    return fallo(error, sesion);
  }
  return { tipo: "confirmada" };
}

export async function pedirOpcionesDeConfirmacion(): Promise<
  { tipo: "opciones"; opciones: unknown } | { tipo: "error"; mensaje: string }
> {
  const sesion = await exigirSesion();
  try {
    return { tipo: "opciones", opciones: await opcionesParaConfirmarConPasskey(sesion, await origenActual()) };
  } catch (error) {
    const estado = fallo(error, sesion);
    return { tipo: "error", mensaje: estado.tipo === "error" ? estado.mensaje : MENSAJES.segundo_factor_invalido! };
  }
}

export async function confirmarIdentidadConPasskey(respuesta: unknown): Promise<EstadoConfirmacion> {
  const sesion = await exigirSesion();
  try {
    await confirmarConPasskey(sesion, respuesta, await origenActual());
  } catch (error) {
    return fallo(error, sesion);
  }
  return { tipo: "confirmada" };
}

async function exigirSesion(): Promise<Sesion> {
  const sesion = await sesionDesdeCookie();
  if (!sesion) redirect("/entrar");
  return sesion;
}

function fallo(error: unknown, sesion: Sesion): EstadoConfirmacion {
  if (error instanceof ErrorDeDominio && error.codigo === "reautenticacion_agotada") {
    redirect(`${sesion.superficie === "sofipo" ? "/operacion/entrar" : "/entrar"}?aviso=reautenticacion_agotada`);
  }
  if (error instanceof ErrorDeDominio) {
    return { tipo: "error", mensaje: MENSAJES[error.codigo] ?? "No se pudo confirmar. Vuelve a intentar." };
  }
  throw error;
}

async function origenActual() {
  const encabezados = await headers();
  return origenDe(
    encabezados.get("x-forwarded-host") ?? encabezados.get("host"),
    encabezados.get("x-forwarded-proto"),
    dominiosDesdeEntorno(),
  );
}
