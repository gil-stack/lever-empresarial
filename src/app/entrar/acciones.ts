"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { fijarCookieDeSesion, sesionDesdeCookie } from "@/server/entrada";
import {
  agregarPasskeyDeSesion,
  confirmarTotpDeSesion,
  destinoSeguro,
  dominiosDesdeEntorno,
  entrarConPasskey,
  entrarConRespaldo,
  entrarConTotp,
  iniciarConContrasena,
  inscribirPasskey,
  inscribirTotp,
  NOMBRE_COOKIE_ENTRADA,
  nuevosCodigos,
  opcionesParaEntrarConPasskey,
  opcionesParaInscribirPasskey,
  opcionesPasskeyDeSesion,
  origenDe,
  pedirRecuperacion,
  prepararTotpDeSesion,
  quitarPasskey,
  quitarTotp,
  RECHAZO_DE_CONTRASENA,
  rutaDeDestino,
} from "@/server/autenticacion";
import { ipDeEncabezados } from "@/server/autenticacion/limites";
import { leerTokenEntrada, NOMBRE_COOKIE_PORTAL, type CookieEntrada } from "@/server/autenticacion/cookie";
import { encabezadoDeSesion, NOMBRE_COOKIE, VIGENCIA_SESION_MS } from "@/server/session/cookie";
import { ErrorDeDominio, leerSesion } from "@/server/session";
import type { Sesion } from "@/server/session/tipos";

import type { EstadoFactor } from "./estado";
import type { EstadoEntrada } from "../sesion/estado";

const MENSAJES: Record<string, string> = {
  credenciales_invalidas: RECHAZO_DE_CONTRASENA,
  entrada_vencida: "Esa entrada venció. Vuelve a escribir tu contraseña.",
  entrada_agotada: "Demasiados intentos. Vuelve a escribir tu contraseña.",
  segundo_factor_invalido: "Ese código no coincide. Vuelve a intentar.",
  passkey_ausente: "No hay una passkey registrada en esta cuenta.",
  totp_no_disponible: "La app autenticadora no está disponible. Usa una passkey.",
  qr_no_disponible: "No se pudo armar el código QR.",
  ultimo_factor: "Agrega otro método antes de quitar este. Sin segundo factor no se entra.",
  ya_tiene_segundo_factor: "Ese método ya está registrado.",
  recuperacion_abierta: "Ya hay una solicitud en revisión.",
  recuperacion_no_aplica: "Primero registra un segundo factor.",
  recuperacion_vencida: "La autorización venció. Vuelve a pedirla.",
  motivo_invalido: "Escribe el motivo, en una frase.",
  origen_no_permitido: "Esta dirección no puede usar passkeys.",
  segundo_factor_ausente: "Entra de nuevo con tu segundo factor.",
  reautenticacion_requerida:
    "Confirma que eres tú: cambiar tus métodos exige tu segundo factor de los últimos cinco minutos.",
};

export async function enviarContrasena(previo: EstadoEntrada, formData: FormData): Promise<EstadoEntrada> {
  void previo;
  const destino = destinoSeguro(formData.get("siguiente"));
  const correo = String(formData.get("correo") ?? "").slice(0, 254);
  try {
    const resultado = await iniciarConContrasena({
      correo,
      contrasena: String(formData.get("contrasena") ?? ""),
      ip: ipDeEncabezados(await headers()),
    });
    if (resultado.tipo === "rechazo") return { tipo: "invalido", mensaje: texto(resultado.codigo), correo };
    await ponerEntrada(resultado.cookie);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return { tipo: "invalido", mensaje: texto(error.codigo), correo };
    throw error;
  }
  redirect(`/entrar/continuar?siguiente=${encodeURIComponent(destino)}`);
}

export async function enviarTotp(_previo: EstadoFactor, formData: FormData): Promise<EstadoFactor> {
  const destino = destinoSeguro(formData.get("siguiente"));
  try {
    const setCookie = await entrarConTotp(await tokenDeEntrada(), formData.get("codigo"));
    await fijarCookieDeSesion(setCookie);
    await quitarEntrada();
  } catch (error) {
    return await salida(error, destino);
  }
  redirect(rutaDeDestino(destino));
}

export async function enviarRespaldo(_previo: EstadoFactor, formData: FormData): Promise<EstadoFactor> {
  const destino = destinoSeguro(formData.get("siguiente"));
  try {
    const setCookie = await entrarConRespaldo(await tokenDeEntrada(), formData.get("codigo"));
    await fijarCookieDeSesion(setCookie);
    await quitarEntrada();
  } catch (error) {
    return await salida(error, destino);
  }
  redirect(rutaDeDestino(destino));
}

export async function pedirOpcionesPasskey(): Promise<{ tipo: "opciones"; opciones: unknown } | { tipo: "error"; mensaje: string }> {
  try {
    return { tipo: "opciones", opciones: await opcionesParaEntrarConPasskey(await tokenDeEntrada(), await origenActual()) };
  } catch (error) {
    return { tipo: "error", mensaje: textoDe(error) };
  }
}

export async function enviarPasskey(respuesta: unknown, siguiente: string): Promise<{ tipo: "error"; mensaje: string }> {
  const destino = destinoSeguro(siguiente);
  try {
    const setCookie = await entrarConPasskey(await tokenDeEntrada(), respuesta, await origenActual());
    await fijarCookieDeSesion(setCookie);
    await quitarEntrada();
  } catch (error) {
    const estado = await salida(error, destino);
    return { tipo: "error", mensaje: estado.tipo === "error" ? estado.mensaje : "No se pudo usar la passkey." };
  }
  redirect(rutaDeDestino(destino));
}

export async function enviarInscripcionTotp(_previo: EstadoFactor, formData: FormData): Promise<EstadoFactor> {
  try {
    const inscripcion = await inscribirTotp(await tokenDeEntrada(), formData.get("codigo"));
    await dejarPortalPendiente(inscripcion.setCookie);
    await quitarEntrada();
    return { tipo: "codigos", codigos: inscripcion.codigos };
  } catch (error) {
    return await salida(error, destinoSeguro(formData.get("siguiente")));
  }
}

export async function pedirRegistroPasskey(): Promise<{ tipo: "opciones"; opciones: unknown } | { tipo: "error"; mensaje: string }> {
  try {
    return {
      tipo: "opciones",
      opciones: await opcionesParaInscribirPasskey(await tokenDeEntrada(), await origenActual()),
    };
  } catch (error) {
    return { tipo: "error", mensaje: textoDe(error) };
  }
}

export async function enviarRegistroPasskey(
  respuesta: unknown,
  nombre: string,
): Promise<{ tipo: "error"; mensaje: string } | { tipo: "codigos"; codigos: string[] }> {
  try {
    const inscripcion = await inscribirPasskey(await tokenDeEntrada(), respuesta, await origenActual(), nombre);
    await dejarPortalPendiente(inscripcion.setCookie);
    await quitarEntrada();
    return { tipo: "codigos", codigos: inscripcion.codigos };
  } catch (error) {
    const estado = await salida(error, "/consola");
    return { tipo: "error", mensaje: estado.tipo === "error" ? estado.mensaje : "No se pudo registrar la passkey." };
  }
}

/** Pasa la sesión pendiente a la cookie que el portal sí honra. */
export async function abrirPortal(formData: FormData): Promise<void> {
  const destino = destinoSeguro(formData.get("siguiente"));
  const jar = await cookies();
  const token = leerTokenEntrada(jar.get(NOMBRE_COOKIE_PORTAL)?.value);
  if (token) {
    const sesion = await leerSesion(`${NOMBRE_COOKIE}=${token}`);
    jar.set(NOMBRE_COOKIE_PORTAL, "", cookieVacia());
    if (sesion) {
      const ahora = new Date();
      await fijarCookieDeSesion(encabezadoDeSesion(token, new Date(ahora.getTime() + VIGENCIA_SESION_MS), ahora));
      redirect(rutaDeDestino(destino));
    }
  }
  if (await sesionDesdeCookie()) redirect(rutaDeDestino(destino));
  redirect(`/entrar?siguiente=${encodeURIComponent(destino)}`);
}

export async function enviarRecuperacion(_previo: EstadoFactor, formData: FormData): Promise<EstadoFactor> {
  try {
    await pedirRecuperacion(await tokenDeEntrada(), formData.get("motivo"));
    await quitarEntrada();
  } catch (error) {
    return await salida(error, "/entrar");
  }
  redirect("/entrar?aviso=recuperacion");
}

export async function empezarTotpDeCuenta(): Promise<EstadoFactor> {
  const { sesionDesdeCookie } = await import("@/server/entrada");
  const sesion = await exigir(await sesionDesdeCookie());
  try {
    return { tipo: "alta", alta: await prepararTotpDeSesion(sesion) };
  } catch (error) {
    return errorDeFactor(error);
  }
}

export async function confirmarTotpDeCuenta(_previo: EstadoFactor, formData: FormData): Promise<EstadoFactor> {
  const { sesionDesdeCookie } = await import("@/server/entrada");
  const sesion = await exigir(await sesionDesdeCookie());
  try {
    await confirmarTotpDeSesion(sesion, formData.get("codigo"));
  } catch (error) {
    return errorDeFactor(error);
  }
  redirect("/entrar/seguridad");
}

export async function pedirPasskeyDeCuenta(): Promise<
  { tipo: "opciones"; opciones: unknown } | { tipo: "error"; mensaje: string; codigo?: string }
> {
  const { sesionDesdeCookie } = await import("@/server/entrada");
  try {
    const sesion = await exigir(await sesionDesdeCookie());
    return { tipo: "opciones", opciones: await opcionesPasskeyDeSesion(sesion, await origenActual()) };
  } catch (error) {
    return { tipo: "error", mensaje: textoDe(error), codigo: codigoDe(error) };
  }
}

export async function guardarPasskeyDeCuenta(
  respuesta: unknown,
  nombre: string,
): Promise<{ tipo: "error"; mensaje: string; codigo?: string } | { tipo: "listo" }> {
  const { sesionDesdeCookie } = await import("@/server/entrada");
  try {
    const sesion = await exigir(await sesionDesdeCookie());
    await agregarPasskeyDeSesion(sesion, respuesta, await origenActual(), nombre);
  } catch (error) {
    return { tipo: "error", mensaje: textoDe(error), codigo: codigoDe(error) };
  }
  redirect("/entrar/seguridad");
}

export async function revocarPasskeyDeCuenta(formData: FormData): Promise<void> {
  const { sesionDesdeCookie } = await import("@/server/entrada");
  const sesion = await exigir(await sesionDesdeCookie());
  try {
    await quitarPasskey(sesion, formData.get("passkey"));
  } catch (error) {
    if (error instanceof ErrorDeDominio) redirect(`/entrar/seguridad?aviso=${error.codigo}`);
    throw error;
  }
  redirect("/entrar/seguridad");
}

export async function revocarTotpDeCuenta(): Promise<void> {
  const { sesionDesdeCookie } = await import("@/server/entrada");
  const sesion = await exigir(await sesionDesdeCookie());
  try {
    await quitarTotp(sesion);
  } catch (error) {
    if (error instanceof ErrorDeDominio) redirect(`/entrar/seguridad?aviso=${error.codigo}`);
    throw error;
  }
  redirect("/entrar/seguridad");
}

export async function regenerarCodigosDeCuenta(): Promise<EstadoFactor> {
  const { sesionDesdeCookie } = await import("@/server/entrada");
  const sesion = await exigir(await sesionDesdeCookie());
  try {
    return { tipo: "codigos", codigos: await nuevosCodigos(sesion) };
  } catch (error) {
    return errorDeFactor(error);
  }
}

async function exigir(sesion: Sesion | null): Promise<Sesion> {
  if (!sesion) redirect("/entrar?siguiente=/entrar/seguridad");
  return sesion;
}

async function salida(error: unknown, destino: string): Promise<EstadoFactor> {
  if (error instanceof ErrorDeDominio && (error.codigo === "entrada_vencida" || error.codigo === "entrada_agotada")) {
    await quitarEntrada();
    redirect(`/entrar?aviso=${error.codigo}&siguiente=${encodeURIComponent(destino)}`);
  }
  return errorDeFactor(error);
}

function errorDeFactor(error: unknown): EstadoFactor {
  if (error instanceof ErrorDeDominio) return { tipo: "error", mensaje: texto(error.codigo), codigo: error.codigo };
  throw error;
}

function texto(codigo: string): string {
  if (!MENSAJES[codigo]) registrarInesperado(codigo);
  return MENSAJES[codigo] ?? "No se pudo completar. Vuelve a intentar.";
}

function textoDe(error: unknown): string {
  if (error instanceof ErrorDeDominio) return texto(error.codigo);
  registrarInesperado(error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name) ? error.name : "desconocido");
  return "No se pudo completar. Vuelve a intentar.";
}

/**
 * Un rechazo sin mensaje propio llega a la persona como «Vuelve a intentar»; aquí queda su código
 * para poder diagnosticarlo. Solo el código o el nombre del error: nada de la persona ni del factor.
 */
function registrarInesperado(codigo: string): void {
  console.error(JSON.stringify({ nivel: "error", origen: "entrar.factor", evento: "factor_no_completado", error: codigo }));
}

function codigoDe(error: unknown): string | undefined {
  return error instanceof ErrorDeDominio ? error.codigo : undefined;
}

async function tokenDeEntrada(): Promise<string | null> {
  const jar = await cookies();
  return leerTokenEntrada(jar.get(NOMBRE_COOKIE_ENTRADA)?.value);
}

async function ponerEntrada(cookie: CookieEntrada): Promise<void> {
  const jar = await cookies();
  jar.set(cookie.nombre, cookie.valor, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: cookie.maxAge,
  });
}

async function dejarPortalPendiente(setCookie: string): Promise<void> {
  const primera = setCookie.split(";")[0]?.trim() ?? "";
  const separador = primera.indexOf("=");
  const valor = separador > 0 ? primera.slice(separador + 1) : "";
  if (!leerTokenEntrada(valor)) throw new ErrorDeDominio("sesion_ausente");
  const jar = await cookies();
  jar.set(NOMBRE_COOKIE_PORTAL, valor, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(VIGENCIA_SESION_MS / 1000),
  });
}

function cookieVacia(): {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: 0;
} {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 };
}

async function quitarEntrada(): Promise<void> {
  const jar = await cookies();
  jar.set(NOMBRE_COOKIE_ENTRADA, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

async function origenActual() {
  const encabezados = await headers();
  return origenDe(
    encabezados.get("x-forwarded-host") ?? encabezados.get("host"),
    encabezados.get("x-forwarded-proto"),
    dominiosDesdeEntorno(),
  );
}
