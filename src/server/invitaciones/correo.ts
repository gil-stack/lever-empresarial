import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { EnviarInvitacion } from "./tipos";

/**
 * Implementación del puerto de correo. Mientras no haya proveedor de correo
 * transaccional, la invitación queda emitida y no sale: el llamador lo dice y
 * se puede reenviar. El frente de correo reemplaza este cuerpo.
 */
export const enviarInvitacion: EnviarInvitacion = async () => {
  throw new ErrorDeDominio("correo_no_configurado");
};

/**
 * El enlace sale de una URL configurada, nunca de la cabecera Host de la
 * petición: esa la escribe el navegador y mandaría el enlace a otro dominio.
 */
export function urlPublica(env: NodeJS.ProcessEnv = process.env): string {
  const configurada = env.PLATAFORMA_URL_PUBLICA?.trim();
  if (configurada) return sinDiagonalFinal(validarUrl(configurada));
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return sinDiagonalFinal(validarUrl(`https://${vercel}`));
  if (env.NODE_ENV !== "production") return "http://localhost:3000";
  throw new ErrorDeDominio("url_publica_no_configurada");
}

export function enlaceDeInvitacion(base: string, token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ErrorDeDominio("invitacion_invalida");
  return `${sinDiagonalFinal(base)}/invitacion/${token}`;
}

function validarUrl(valor: string): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new ErrorDeDominio("url_publica_no_configurada");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ErrorDeDominio("url_publica_no_configurada");
  }
  return url.origin;
}

function sinDiagonalFinal(valor: string): string {
  return valor.replace(/\/+$/, "");
}
