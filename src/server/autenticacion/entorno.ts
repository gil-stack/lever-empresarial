import { llaveDesde } from "./cifrado";

/**
 * Lo único que este módulo lee del entorno. Si falta, el error dice qué
 * falta. El valor no se imprime ni se copia a un mensaje.
 */

export const VARIABLE_LLAVE_TOTP = "AUTENTICACION_LLAVE_TOTP";
export const VARIABLE_DOMINIOS = "AUTENTICACION_DOMINIOS";

export function llaveTotpDesdeEntorno(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  return llaveDesde(env[VARIABLE_LLAVE_TOTP]);
}

/**
 * Dominios donde una passkey puede registrarse. Vercel publica el de
 * producción y el de cada vista previa; `AUTENTICACION_DOMINIOS` suma los
 * propios, separados por coma. En desarrollo vale `localhost`.
 */
export function dominiosDesdeEntorno(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const dominios = new Set<string>();
  const sumar = (valor: string | undefined) => {
    if (typeof valor !== "string") return;
    for (const pieza of valor.split(",")) {
      const limpio = pieza.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (limpio) dominios.add(limpio);
    }
  };
  sumar(env[VARIABLE_DOMINIOS]);
  sumar(env.VERCEL_PROJECT_PRODUCTION_URL);
  sumar(env.VERCEL_BRANCH_URL);
  sumar(env.VERCEL_URL);
  if (env.NODE_ENV !== "production") dominios.add("localhost");
  return dominios;
}
