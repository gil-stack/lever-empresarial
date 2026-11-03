import "server-only";

import { cookies } from "next/headers";

import { leerEmpresa } from "./company";
import { leerSesion } from "./session";
import { NOMBRE_COOKIE } from "./session/cookie";
import { ErrorDeDominio } from "./session/error-de-dominio";

export type Entrada = {
  nombre: string | null;
  rfc: string | null;
  razonSocial: string | null;
  libroDisponible: boolean;
};

const VACIA: Entrada = {
  nombre: null,
  rfc: null,
  razonSocial: null,
  libroDisponible: true,
};

/**
 * Lee la cookie que armó `src/server/session` y la empresa de esa membresía.
 * `companyIdPedido` llega del navegador y no autoriza: `leerEmpresa` lo ignora.
 */
export async function leerEntrada(companyIdPedido?: string | null): Promise<Entrada> {
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return VACIA;
    const empresa = await leerEmpresa(sesion, { companyId: companyIdPedido });
    return {
      nombre: sesion.usuario.nombre,
      rfc: empresa?.rfc ?? null,
      razonSocial: empresa?.razonSocial ?? null,
      libroDisponible: true,
    };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      return { nombre: null, rfc: null, razonSocial: null, libroDisponible: false };
    }
    if (pareceSecreto(error)) {
      return { nombre: null, rfc: null, razonSocial: null, libroDisponible: false };
    }
    throw error;
  }
}

export async function sesionDesdeCookie() {
  const jar = await cookies();
  const token = jar.get(NOMBRE_COOKIE)?.value;
  if (!token) return null;
  return leerSesion(`${NOMBRE_COOKIE}=${token}`);
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
  if (nombre !== NOMBRE_COOKIE) throw new ErrorDeDominio("sesion_ausente");
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

function pareceSecreto(error: unknown): boolean {
  const texto = error instanceof Error ? `${error.name} ${error.message}` : "";
  return /postgres(ql)?:\/\//i.test(texto) || /DATABASE_URL/i.test(texto);
}
