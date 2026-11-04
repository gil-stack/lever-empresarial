import { tokenValido } from "../session/cookie";

/**
 * Cookie de la entrada. Dice que la contraseña ya coincidió y nada más:
 * no abre el portal. Dura diez minutos y es distinta de la cookie `sesion`.
 */

export const NOMBRE_COOKIE_ENTRADA = "entrada";

/**
 * La sesión ya existe, pero el portal no la honra todavía. La persona tiene
 * que ver los códigos de respaldo antes de que la cookie `sesion` abra la
 * consola. Si esa cookie se fijara en la misma acción, la página redirige
 * y los códigos no llegan a mostrarse.
 */
export const NOMBRE_COOKIE_PORTAL = "portal";
export const VIGENCIA_ENTRADA_MS = 10 * 60 * 1000;

export function leerTokenEntrada(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null;
  return tokenValido(valor) ? valor : null;
}

export type CookieEntrada = {
  nombre: typeof NOMBRE_COOKIE_ENTRADA;
  valor: string;
  maxAge: number;
};

export function cookieDeEntrada(token: string): CookieEntrada {
  return { nombre: NOMBRE_COOKIE_ENTRADA, valor: token, maxAge: VIGENCIA_ENTRADA_MS / 1000 };
}

export function cookieSinEntrada(): CookieEntrada {
  return { nombre: NOMBRE_COOKIE_ENTRADA, valor: "", maxAge: 0 };
}
