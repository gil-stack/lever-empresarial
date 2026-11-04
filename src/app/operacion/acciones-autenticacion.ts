"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  dominiosDesdeEntorno,
  entrarConPasskey,
  entrarConRespaldo,
  entrarConTotp,
  iniciarConContrasena,
  inscribirPasskey,
  inscribirTotp,
  opcionesParaEntrarConPasskey,
  opcionesParaInscribirPasskey,
  origenDe,
} from "@/server/autenticacion";
import { leerTokenEntrada } from "@/server/autenticacion/cookie";
import { fijarCookieDeSesion } from "@/server/entrada";
import { NOMBRE_COOKIE_ENTRADA_OPERACION, NOMBRE_COOKIE_PORTAL_OPERACION } from "@/server/operacion/acceso";
import { ErrorDeDominio, leerSesion } from "@/server/session";
import { encabezadoDeSesion } from "@/server/session/cookie";

import type { EstadoAcceso } from "./tipos-acceso";

const SOFIPO = { superficie: "sofipo" } as const;

export async function entrarOperacion(formData: FormData): Promise<void> {
  try {
    const resultado = await iniciarConContrasena({
      correo: String(formData.get("correo") ?? ""),
      contrasena: String(formData.get("contrasena") ?? ""),
    });
    if (resultado.tipo === "rechazo") redirect(`/operacion/entrar?aviso=${resultado.codigo}`);
    await ponerToken(NOMBRE_COOKIE_ENTRADA_OPERACION, resultado.cookie.valor, resultado.cookie.maxAge);
  } catch (error) {
    if (error instanceof ErrorDeDominio) redirect(`/operacion/entrar?aviso=${error.codigo}`);
    throw error;
  }
  redirect("/operacion/continuar");
}

export async function verificarTotpOperacion(_previo: EstadoAcceso, formData: FormData): Promise<EstadoAcceso> {
  try {
    const setCookie = await entrarConTotp(await tokenEntrada(), formData.get("codigo"), SOFIPO);
    await fijarCookieDeSesion(setCookie);
    await quitarToken(NOMBRE_COOKIE_ENTRADA_OPERACION);
  } catch (error) {
    return salidaDeFactor(error);
  }
  redirect("/operacion");
}

export async function verificarRespaldoOperacion(_previo: EstadoAcceso, formData: FormData): Promise<EstadoAcceso> {
  try {
    const setCookie = await entrarConRespaldo(await tokenEntrada(), formData.get("codigo"), SOFIPO);
    await fijarCookieDeSesion(setCookie);
    await quitarToken(NOMBRE_COOKIE_ENTRADA_OPERACION);
  } catch (error) {
    return salidaDeFactor(error);
  }
  redirect("/operacion");
}

export async function opcionesPasskeyOperacion(): Promise<{ tipo: "opciones"; opciones: unknown } | { tipo: "error"; mensaje: string }> {
  try {
    return { tipo: "opciones", opciones: await opcionesParaEntrarConPasskey(await tokenEntrada(), await origenActual()) };
  } catch (error) {
    return { tipo: "error", mensaje: mensajeDe(error) };
  }
}

export async function verificarPasskeyOperacion(respuesta: unknown): Promise<{ tipo: "error"; mensaje: string }> {
  try {
    const setCookie = await entrarConPasskey(await tokenEntrada(), respuesta, await origenActual(), SOFIPO);
    await fijarCookieDeSesion(setCookie);
    await quitarToken(NOMBRE_COOKIE_ENTRADA_OPERACION);
  } catch (error) {
    return { tipo: "error", mensaje: mensajeDe(error) };
  }
  redirect("/operacion");
}

export async function opcionesRegistroOperacion(): Promise<{ tipo: "opciones"; opciones: unknown } | { tipo: "error"; mensaje: string }> {
  try {
    return { tipo: "opciones", opciones: await opcionesParaInscribirPasskey(await tokenEntrada(), await origenActual()) };
  } catch (error) {
    return { tipo: "error", mensaje: mensajeDe(error) };
  }
}

export async function registrarTotpOperacion(_previo: EstadoAcceso, formData: FormData): Promise<EstadoAcceso> {
  try {
    const inscripcion = await inscribirTotp(await tokenEntrada(), formData.get("codigo"), SOFIPO);
    await dejarPortalPendiente(inscripcion.setCookie);
    await quitarToken(NOMBRE_COOKIE_ENTRADA_OPERACION);
    return { tipo: "codigos", codigos: inscripcion.codigos };
  } catch (error) {
    return salidaDeFactor(error);
  }
}

export async function registrarPasskeyOperacion(
  respuesta: unknown,
  nombre: string,
): Promise<EstadoAcceso> {
  try {
    const inscripcion = await inscribirPasskey(await tokenEntrada(), respuesta, await origenActual(), nombre, SOFIPO);
    await dejarPortalPendiente(inscripcion.setCookie);
    await quitarToken(NOMBRE_COOKIE_ENTRADA_OPERACION);
    return { tipo: "codigos", codigos: inscripcion.codigos };
  } catch (error) {
    return { tipo: "error", mensaje: mensajeDe(error) };
  }
}

export async function abrirPortalOperacion(): Promise<void> {
  const jar = await cookies();
  const token = leerTokenEntrada(jar.get(NOMBRE_COOKIE_PORTAL_OPERACION)?.value);
  if (token) {
    const sesion = await leerSesion(`sesion=${token}`);
    if (sesion?.superficie === "sofipo") {
      await fijarCookieDeSesion(encabezadoDeSesion(token, sesion.venceEn, new Date()));
      await quitarToken(NOMBRE_COOKIE_PORTAL_OPERACION);
      redirect("/operacion");
    }
  }
  redirect("/operacion/entrar?aviso=entrada_vencida");
}

async function tokenEntrada(): Promise<string | null> {
  const jar = await cookies();
  return leerTokenEntrada(jar.get(NOMBRE_COOKIE_ENTRADA_OPERACION)?.value);
}

async function dejarPortalPendiente(setCookie: string): Promise<void> {
  const valor = setCookie.split(";")[0]?.split("=")[1] ?? "";
  if (!leerTokenEntrada(valor)) throw new ErrorDeDominio("sesion_ausente");
  await ponerToken(NOMBRE_COOKIE_PORTAL_OPERACION, valor, 12 * 60 * 60);
}

async function ponerToken(nombre: string, valor: string, maxAge: number): Promise<void> {
  const jar = await cookies();
  jar.set(nombre, valor, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge });
}

async function quitarToken(nombre: string): Promise<void> {
  await ponerToken(nombre, "", 0);
}

async function origenActual() {
  const cabeceras = await headers();
  return origenDe(cabeceras.get("x-forwarded-host") ?? cabeceras.get("host"), cabeceras.get("x-forwarded-proto"), dominiosDesdeEntorno());
}

function salidaDeFactor(error: unknown): EstadoAcceso {
  if (error instanceof ErrorDeDominio && (error.codigo === "entrada_vencida" || error.codigo === "entrada_agotada")) {
    redirect(`/operacion/entrar?aviso=${error.codigo}`);
  }
  return { tipo: "error", mensaje: mensajeDe(error) };
}

function mensajeDe(error: unknown): string {
  if (!(error instanceof ErrorDeDominio)) return "No se pudo completar. Vuelve a intentar.";
  const mensajes: Record<string, string> = {
    segundo_factor_invalido: "El código o la passkey no coinciden.",
    entrada_vencida: "La entrada venció. Vuelve a escribir tu contraseña.",
    entrada_agotada: "Demasiados intentos. Vuelve a escribir tu contraseña.",
    passkey_ausente: "No hay una passkey registrada.",
    totp_no_disponible: "La app autenticadora no está disponible. Usa una passkey.",
    origen_no_permitido: "Este dominio no puede usar passkeys.",
  };
  return mensajes[error.codigo] ?? "No se pudo completar. Vuelve a intentar.";
}
