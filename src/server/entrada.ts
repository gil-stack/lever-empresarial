import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { type Superficie } from "../nucleo/capacidades";
import { puede, type ContextoDeTenant } from "../nucleo/contexto";
import { ErrorDeDominio } from "../nucleo/error-de-dominio";
import {
  CABECERA_EMPRESA,
  CABECERA_PETICION,
  RUTA_SEGUNDO_FACTOR,
  rutaDeclarada,
  type PatronDeRuta,
} from "../nucleo/rutas";
import { leerSesion } from "./session";
import { NOMBRE_COOKIE, NOMBRE_COOKIE_PARCIAL } from "./session/cookie";
import type { Sesion } from "./session/tipos";
import { resolverContexto, type ContextoResuelto } from "./tenencia/resolver";

export type Apertura =
  | { tipo: "abierta"; ctx: ContextoDeTenant }
  | { tipo: "sin_permiso"; ctx: ContextoDeTenant }
  | { tipo: "sin_empresa"; ctx: ContextoDeTenant }
  | { tipo: "libro" };

export type Entrada = {
  nombre: string | null;
  rfc: string | null;
  razonSocial: string | null;
  libroDisponible: boolean;
};

type Resolucion = ContextoResuelto | null | "libro";

const VACIA: Entrada = { nombre: null, rfc: null, razonSocial: null, libroDisponible: true };

/**
 * Una lectura de sesión y de membresías por petición. La superficie es la de
 * la ruta, no un valor fijo: el teléfono no queda anotado como consola.
 * Sin segundo factor la cookie no cuenta.
 */
export const contextoDePeticion = cache(async (superficie: Superficie = "cliente"): Promise<Resolucion> => {
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return null;
    const cabeceras = await headers();
    return await resolverContexto({
      sesion,
      empresaPedida: cabeceras.get(CABECERA_EMPRESA),
      peticionId: cabeceras.get(CABECERA_PETICION),
      superficie,
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return "libro";
    throw error;
  }
});

/** Para páginas públicas: el contexto si hay sesión completa, o nada. */
export async function contextoOpcional(superficie: Superficie = "cliente"): Promise<ContextoDeTenant | null> {
  const resuelto = await contextoDePeticion(superficie);
  return resuelto && resuelto !== "libro" ? resuelto.ctx : null;
}

/**
 * La página declara su ruta y aquí se decide con el registro de rutas y la
 * matriz de capacidades. Sin sesión se va a entrar; con la entrada del
 * segundo factor, a registrarlo o verificarlo; con varias empresas y ninguna
 * en la ruta, a elegir; con una empresa ajena en la ruta, no existe.
 */
export async function abrirRuta(patron: PatronDeRuta): Promise<Apertura> {
  const ruta = rutaDeclarada(patron);
  const resuelto = await contextoDePeticion(ruta.superficie);
  if (resuelto === "libro") return { tipo: "libro" };
  if (!resuelto) {
    const jar = await cookies();
    const entrada = jar.get("entrada")?.value || jar.get("portal")?.value;
    redirect(entrada ? RUTA_SEGUNDO_FACTOR : "/entrar");
  }
  const { ctx, eleccion } = resuelto;
  if (eleccion === "ajena") notFound();
  if (ruta.conEmpresa && eleccion === "pendiente") redirect("/empresas");
  if (ruta.acceso.tipo === "capacidad" && !ruta.acceso.alguna.some((capacidad) => puede(ctx, capacidad))) {
    return ctx.empresa || ctx.personal ? { tipo: "sin_permiso", ctx } : { tipo: "sin_empresa", ctx };
  }
  return { tipo: "abierta", ctx };
}

/** Las acciones de servidor piden el mismo contexto. Sin sesión no hay contexto. */
export async function contextoDeAccion(superficie: Superficie = "cliente"): Promise<ContextoDeTenant | null> {
  const resuelto = await contextoDePeticion(superficie);
  if (!resuelto || resuelto === "libro") return null;
  if (resuelto.eleccion === "ajena") return null;
  return resuelto.ctx;
}

/** Lo que el portal muestra de quien ya entró. Sin segundo factor, no hay nombre. */
export async function leerEntrada(superficie: Superficie = "cliente"): Promise<Entrada> {
  try {
    const resuelto = await contextoDePeticion(superficie);
    if (!resuelto || resuelto === "libro") {
      return resuelto === "libro" ? { ...VACIA, libroDisponible: false } : VACIA;
    }
    return {
      nombre: resuelto.ctx.persona.nombre,
      rfc: resuelto.ctx.empresa?.rfc ?? null,
      razonSocial: resuelto.ctx.empresa?.razonSocial ?? null,
      libroDisponible: true,
    };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return { ...VACIA, libroDisponible: false };
    throw error;
  }
}

export async function sesionSegura(): Promise<Sesion | null> {
  try {
    return await sesionDesdeCookie();
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return null;
    throw error;
  }
}

export async function sesionDesdeCookie(): Promise<Sesion | null> {
  const jar = await cookies();
  const token = jar.get(NOMBRE_COOKIE)?.value;
  if (!token) return null;
  const sesion = await leerSesion(`${NOMBRE_COOKIE}=${token}`);
  if (!sesion?.segundoFactor) return null;
  return sesion;
}

export function errorConSecreto(error: unknown): boolean {
  const texto = error instanceof Error ? `${error.name} ${error.message}` : "";
  return /postgres(ql)?:\/\//i.test(texto) || /DATABASE_URL/i.test(texto);
}

/** Aplica los encabezados que ya construyó la sesión, en orden. */
export async function fijarCookiesDeSesion(setCookies: readonly string[]): Promise<void> {
  for (const setCookie of setCookies) await fijarCookieDeSesion(setCookie);
}

/** Aplica el encabezado que ya construyó la sesión, sin devolver el token a la página. */
export async function fijarCookieDeSesion(setCookie: string): Promise<void> {
  const partes = setCookie
    .split(";")
    .map((parte) => parte.trim())
    .filter(Boolean);
  const primera = partes[0] ?? "";
  const separador = primera.indexOf("=");
  if (separador < 1) throw new ErrorDeDominio("sesion_ausente");
  const nombre = primera.slice(0, separador);
  if (nombre !== NOMBRE_COOKIE && nombre !== NOMBRE_COOKIE_PARCIAL) throw new ErrorDeDominio("sesion_ausente");
  const valor = primera.slice(separador + 1);
  const attrs = new Map<string, string>();
  for (const parte of partes.slice(1)) {
    const corte = parte.indexOf("=");
    if (corte === -1) attrs.set(parte.toLowerCase(), "");
    else attrs.set(parte.slice(0, corte).toLowerCase(), parte.slice(corte + 1));
  }
  const maxAge = Number(attrs.get("max-age"));
  const expira = attrs.get("expires");
  const jar = await cookies();
  jar.set(nombre, valor, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: attrs.get("path") || "/",
    ...(Number.isFinite(maxAge) ? { maxAge } : {}),
    ...(expira ? { expires: new Date(expira) } : {}),
  });
}
