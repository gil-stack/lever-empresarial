import { correoValido, normalizarCorreo } from "../session/validar";

/** Lista de correos del operador. No es un rol dentro de la empresa. */
export const VARIABLE_OPERADORES = "OPERADORES_PLATAFORMA";

export function leerOperadores(valor: string | undefined): ReadonlySet<string> {
  if (!valor) return new Set();
  const correos = new Set<string>();
  for (const pieza of valor.split(",")) {
    const correo = normalizarCorreo(pieza);
    if (correoValido(correo)) correos.add(correo);
  }
  return correos;
}

export function esCorreoOperador(correo: string, lista: ReadonlySet<string>): boolean {
  return lista.has(normalizarCorreo(correo));
}

export function operadoresDesdeEntorno(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const valor = env[VARIABLE_OPERADORES];
  return leerOperadores(typeof valor === "string" ? valor : undefined);
}
