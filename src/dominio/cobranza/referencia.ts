/**
 * Referencia numérica de un cargo: los 7 dígitos que caben en el campo
 * «referencia» de una transferencia SPEI. Seis son un consecutivo por empresa y
 * el último es el dígito de Luhn: un dígito tecleado mal ya no es la referencia
 * de otro cargo. La base revisa lo mismo (cobranza_referencia_valida, 0031).
 */

export const TOPE_CONSECUTIVO = 999_999;

/** El dígito de Luhn para seis dígitos: con él, el número completo de 7 cierra. */
export function digitoLuhn(seis: string): number {
  if (!/^[0-9]{6}$/.test(seis)) throw new Error("referencia_invalida");
  let suma = 0;
  // Posiciones 1 a 6 del número final de 7; se duplican las pares (2, 4, 6).
  for (let i = 1; i <= 6; i += 1) {
    const d = seis.charCodeAt(i - 1) - 48;
    if (i % 2 === 0) {
      const doble = d * 2;
      suma += doble > 9 ? doble - 9 : doble;
    } else {
      suma += d;
    }
  }
  return (10 - (suma % 10)) % 10;
}

export function referenciaDe(consecutivo: number): string {
  if (!Number.isInteger(consecutivo) || consecutivo < 1 || consecutivo > TOPE_CONSECUTIVO) throw new Error("referencia_agotada");
  const seis = String(consecutivo).padStart(6, "0");
  return `${seis}${digitoLuhn(seis)}`;
}

export function referenciaValida(valor: string): boolean {
  if (!/^[0-9]{7}$/.test(valor)) return false;
  return digitoLuhn(valor.slice(0, 6)) === valor.charCodeAt(6) - 48;
}

/**
 * La referencia como llega en un abono: algunos bancos quitan los ceros de la
 * izquierda. Se completa a 7 dígitos. Lo que no es numérico no es referencia.
 */
export function normalizarReferencia(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null;
  const limpia = valor.trim();
  if (!/^[0-9]{1,7}$/.test(limpia)) return null;
  return limpia.padStart(7, "0");
}
