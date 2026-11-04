import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { enviadorDesdeEntorno } from "../correo/enviar";
import { plantillaInvitacionUsuario } from "../correo/plantillas/invitacion-usuario";
import { ROLES_CLIENTE, type RolCliente } from "../../nucleo/capacidades";
import type { EnviarInvitacion } from "./tipos";

/**
 * Implementación del puerto de correo. Mientras no haya proveedor de correo
 * transaccional, la invitación queda emitida y no sale: el llamador lo dice y
 * se puede reenviar. El frente de correo reemplaza este cuerpo.
 */
export const enviarInvitacion: EnviarInvitacion = async (mensaje) => {
  const enviador = enviadorDesdeEntorno();
  const roles = mensaje.roles.filter((rol): rol is RolCliente => (ROLES_CLIENTE as readonly string[]).includes(rol));
  const plantilla = plantillaInvitacionUsuario({
    nombre: mensaje.nombre,
    razonSocial: mensaje.razonSocial ?? "Arco",
    quienInvita: mensaje.razonSocial ? null : "La operación",
    roles: roles.length > 0 ? roles : ["administrador"],
    enlace: mensaje.enlace,
    venceEn: mensaje.expiraEn,
  });
  await enviador({
    para: mensaje.para,
    asunto: plantilla.asunto,
    html: plantilla.html,
    texto: plantilla.texto,
    idempotencia: `invitacion/${mensaje.invitacionId}`,
  });
};

/**
 * El enlace sale de una URL configurada, nunca de la cabecera Host de la
 * petición: esa la escribe el navegador y mandaría el enlace a otro dominio.
 */
export function urlPublica(env: NodeJS.ProcessEnv = process.env): string {
  const configurada = (env.PLATAFORMA_URL_PUBLICA ?? env.URL_APLICACION)?.trim();
  if (configurada) return sinDiagonalFinal(validarUrl(configurada));
  const vercel =
    env.VERCEL_ENV === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL
      : (env.VERCEL_BRANCH_URL ?? env.VERCEL_URL);
  if (vercel?.trim()) return sinDiagonalFinal(validarUrl(`https://${vercel.trim()}`));
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
