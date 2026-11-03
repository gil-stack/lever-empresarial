import { normalizarRfcDeAlta, validarRfcDeAlta, type MotivoRfcDeAlta } from "../domain/rfc";

export type TipoPersona = "fisica" | "moral";

export type MotivoRfc = MotivoRfcDeAlta;

export function normalizarRfc(valor: string): string {
  return normalizarRfcDeAlta(valor);
}

/**
 * Tope de lo que se puede pegar con espacios o guiones antes de normalizar.
 * El corte a 13 caracteres es del RFC ya sin separadores: si el campo lo
 * cortara antes, `EKU 900317 3C9` perdería el último carácter.
 */
const TOPE_RFC_CON_SEPARADORES = 40;
const TOPE_RFC = 13;

export function rfcAlEscribir(valor: string): string {
  return normalizarRfc(valor.slice(0, TOPE_RFC_CON_SEPARADORES)).slice(0, TOPE_RFC);
}

export function tipoDeRfc(valor: string): TipoPersona | null {
  const resultado = validarRfcDeAlta(valor);
  if (!resultado.ok) return null;
  return resultado.tipo;
}

/** Null si el RFC pasa la regla única del alta. */
export function validarRfc(valor: string): MotivoRfc | null {
  const resultado = validarRfcDeAlta(valor);
  return resultado.ok ? null : resultado.error;
}
