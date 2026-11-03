import { normalizarRfcDeAlta, validarRfcDeAlta, type MotivoRfcDeAlta } from "../domain/rfc";

export type TipoPersona = "fisica" | "moral";

export type MotivoRfc = MotivoRfcDeAlta;

export function normalizarRfc(valor: string): string {
  return normalizarRfcDeAlta(valor);
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
