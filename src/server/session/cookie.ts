import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/** Sesión completa: contraseña y segundo factor. La única que abre un portal. */
export const NOMBRE_COOKIE = "sesion";

/** Sesión parcial: contraseña sola. Solo sirve para verificar el segundo factor. */
export const NOMBRE_COOKIE_PARCIAL = "sesion_parcial";

export const VIGENCIA_SESION_MS = 12 * 60 * 60 * 1000;

export const VIGENCIA_PARCIAL_MS = 10 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function tokenValido(token: string): boolean {
  return TOKEN.test(token);
}

export function leerToken(cookieHeader: string | null | undefined): string | null {
  return leerTokenDe(NOMBRE_COOKIE, cookieHeader);
}

export function leerTokenParcial(cookieHeader: string | null | undefined): string | null {
  return leerTokenDe(NOMBRE_COOKIE_PARCIAL, cookieHeader);
}

function leerTokenDe(nombreCookie: string, cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader || cookieHeader.length > 4096) return null;
  for (const parte of cookieHeader.split(";")) {
    const separador = parte.indexOf("=");
    if (separador === -1) continue;
    const nombre = parte.slice(0, separador).trim();
    if (nombre !== nombreCookie) continue;
    const crudo = parte.slice(separador + 1).trim();
    if (!crudo) return null;
    try {
      const token = decodeURIComponent(crudo);
      return tokenValido(token) ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function encabezadoDeSesion(token: string, vence: Date, ahora: Date): string {
  return encabezado(NOMBRE_COOKIE, token, vence, ahora);
}

export function encabezadoDeSesionParcial(token: string, vence: Date, ahora: Date): string {
  return encabezado(NOMBRE_COOKIE_PARCIAL, token, vence, ahora);
}

export function encabezadoCerrarSesion(): string {
  return cierre(NOMBRE_COOKIE);
}

export function encabezadoCerrarSesionParcial(): string {
  return cierre(NOMBRE_COOKIE_PARCIAL);
}

function encabezado(nombre: string, token: string, vence: Date, ahora: Date): string {
  if (!tokenValido(token)) throw new ErrorDeDominio("sesion_ausente");
  const maxAge = Math.max(0, Math.floor((vence.getTime() - ahora.getTime()) / 1000));
  return [
    `${nombre}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
    `Expires=${vence.toUTCString()}`,
  ].join("; ");
}

function cierre(nombre: string): string {
  return [
    `${nombre}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");
}
