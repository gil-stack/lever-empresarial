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
  RECHAZO_DE_CONTRASENA,
} from "@/server/autenticacion";
import { ipDeEncabezados } from "@/server/autenticacion/limites";
import { leerTokenEntrada } from "@/server/autenticacion/cookie";
import { fijarCookieDeSesion } from "@/server/entrada";
import { NOMBRE_COOKIE_ENTRADA_OPERACION, NOMBRE_COOKIE_PORTAL_OPERACION } from "@/server/operacion/acceso";
import { ErrorDeDominio, leerSesion } from "@/server/session";
import { encabezadoDeSesion, NOMBRE_COOKIE } from "@/server/session/cookie";

import type { EstadoEntrada } from "../sesion/estado";
import type { EstadoAcceso } from "./tipos-acceso";

const SOFIPO = { superficie: "sofipo" } as const;

const RECHAZOS_DE_ENTRADA: Record<string, string> = {
  credenciales_invalidas: RECHAZO_DE_CONTRASENA,
};

/** El rechazo regresa en el estado, con el correo escrito: React reinicia el formulario al terminar. */
export async function entrarOperacion(_previo: EstadoEntrada, formData: FormData): Promise<EstadoEntrada> {
  const correo = String(formData.get("correo") ?? "").slice(0, 254);
  try {
    const resultado = await iniciarConContrasena({
      correo,
      contrasena: String(formData.get("contrasena") ?? ""),
      ip: ipDeEncabezados(await headers()),
    });
    if (resultado.tipo === "rechazo") return { tipo: "invalido", mensaje: RECHAZOS_DE_ENTRADA[resultado.codigo], correo };
    await ponerToken(NOMBRE_COOKIE_ENTRADA_OPERACION, resultado.cookie.valor, resultado.cookie.maxAge);
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      const mensaje = RECHAZOS_DE_ENTRADA[error.codigo];
      if (!mensaje) registrarInesperado("entrada_no_completada", error);
      return { tipo: "invalido", mensaje: mensaje ?? "No se pudo entrar. Vuelve a intentar.", correo };
    }
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
    const sesion = await leerSesion(`${NOMBRE_COOKIE}=${token}`);
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
  if (!(error instanceof ErrorDeDominio)) {
    registrarInesperado("factor_no_completado", error);
    return "No se pudo completar. Vuelve a intentar.";
  }
  const mensajes: Record<string, string> = {
    segundo_factor_invalido: "El código o la passkey no coinciden.",
    entrada_vencida: "La entrada venció. Vuelve a escribir tu contraseña.",
    entrada_agotada: "Demasiados intentos. Vuelve a escribir tu contraseña.",
    passkey_ausente: "No hay una passkey registrada.",
    totp_no_disponible: "La app autenticadora no está disponible. Usa una passkey.",
    origen_no_permitido: "Este dominio no puede usar passkeys.",
  };
  if (!mensajes[error.codigo]) registrarInesperado("factor_no_completado", error);
  return mensajes[error.codigo] ?? "No se pudo completar. Vuelve a intentar.";
}

/**
 * Un rechazo sin mensaje propio llega a la persona como «Vuelve a intentar»; aquí queda su código
 * para poder diagnosticarlo. Solo el código o el nombre del error: nada de la persona ni del factor.
 */
function registrarInesperado(evento: string, error: unknown): void {
  const codigo = error instanceof ErrorDeDominio ? error.codigo : error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name) ? error.name : "desconocido";
  console.error(JSON.stringify({ nivel: "error", origen: "operacion.entrada", evento, error: codigo }));
}
