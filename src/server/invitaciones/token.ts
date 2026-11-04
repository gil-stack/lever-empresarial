import { tokenValido } from "../session/cookie";

export { hashDeToken, tokenNuevo } from "../session/hash";

/** El oficial puede acortarlas. La base rechaza más de 30 días y más de 2 horas. */
export const VIGENCIA_INVITACION_MS = 72 * 60 * 60 * 1000;
export const VIGENCIA_RECUPERACION_MS = 60 * 60 * 1000;

/** Recuperaciones por persona en una hora. Pasado el tope no se manda otro correo. */
export const RECUPERACIONES_POR_HORA = 3;

/** 32 bytes al azar en base64url: la misma forma que el token de la cookie. */
export function tokenConForma(token: unknown): token is string {
  return typeof token === "string" && tokenValido(token);
}
