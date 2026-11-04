import { ErrorDeCorreo } from "./errores";

/**
 * Lo único que este módulo lee del entorno. Los valores no se copian a un
 * error ni a la salida: si algo falta, el error nombra la variable, nunca su
 * contenido.
 */

export type Entorno = Readonly<Record<string, string | undefined>>;

export type ConfiguracionCorreo = {
  apiKey: string;
  remitente: string;
};

const CORREO = /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/;
const CON_NOMBRE = /^([^<>\r\n"]{1,120}?)\s*<([^<>\s]+)>$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

export function leerConfiguracionCorreo(entorno: Entorno = process.env): ConfiguracionCorreo {
  const apiKey = (entorno.RESEND_API_KEY ?? "").trim();
  const remitente = (entorno.CORREO_REMITENTE ?? "").trim();
  const faltan: string[] = [];
  if (!apiKey || /\s/.test(apiKey)) faltan.push("RESEND_API_KEY");
  if (!remitenteValido(remitente)) faltan.push("CORREO_REMITENTE");
  if (faltan.length > 0) throw new ErrorDeCorreo("correo_no_configurado", faltan);
  return { apiKey, remitente };
}

/**
 * La base de los enlaces sale de la configuración, nunca del encabezado Host
 * de la petición: un Host falsificado mandaría el token a otro dominio.
 */
export function leerUrlPublica(entorno: Entorno = process.env): string {
  const explicita = (entorno.URL_APLICACION ?? "").trim();
  const deVercel =
    entorno.VERCEL_ENV === "production"
      ? entorno.VERCEL_PROJECT_PRODUCTION_URL
      : (entorno.VERCEL_BRANCH_URL ?? entorno.VERCEL_URL);
  const candidata = explicita || (deVercel ? `https://${deVercel.trim()}` : "");
  const url = normalizarBase(candidata);
  if (!url) throw new ErrorDeCorreo("correo_no_configurado", ["URL_APLICACION"]);
  return url;
}

function remitenteValido(valor: string): boolean {
  if (!valor || valor.length > 320 || CONTROL.test(valor)) return false;
  const conNombre = CON_NOMBRE.exec(valor);
  const direccion = conNombre ? conNombre[2] : valor;
  return CORREO.test(direccion);
}

function normalizarBase(valor: string): string | null {
  if (!valor) return null;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
