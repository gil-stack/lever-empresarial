import { ErrorDeDominio } from "./error-de-dominio";

export const NOMBRE_COOKIE = "sesion";

export const VIGENCIA_SESION_MS = 12 * 60 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function tokenValido(token: string): boolean {
  return TOKEN.test(token);
}

export function leerToken(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader || cookieHeader.length > 4096) return null;
  for (const parte of cookieHeader.split(";")) {
    const separador = parte.indexOf("=");
    if (separador === -1) continue;
    const nombre = parte.slice(0, separador).trim();
    if (nombre !== NOMBRE_COOKIE) continue;
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
  if (!tokenValido(token)) throw new ErrorDeDominio("sesion_ausente");
  const maxAge = Math.max(0, Math.floor((vence.getTime() - ahora.getTime()) / 1000));
  return [
    `${NOMBRE_COOKIE}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
    `Expires=${vence.toUTCString()}`,
  ].join("; ");
}

export function encabezadoCerrarSesion(): string {
  return [
    `${NOMBRE_COOKIE}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");
}
