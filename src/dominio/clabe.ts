/**
 * Dígito verificador de la CLABE.
 *
 * La ponderación pública es 3, 7 y 1 sobre los primeros 17 dígitos. De cada
 * producto se toma el residuo módulo 10, se suman esos residuos y el dígito
 * es (10 − (suma % 10)) % 10. No es el módulo 10 de la suma de los productos:
 * 8 × 7 aporta 6, no 56.
 *
 * El catálogo del banco no entra aquí. Si el dígito no cierra, la CLABE no se
 * guarda. Los 18 dígitos se conservan completos: no es un PAN.
 */

export const PESOS_CLABE = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7] as const;

export type ClabeResultado =
  | { ok: true; clabe: string }
  | { ok: false; codigo: "clabe_invalida" };

/** Quita espacios y guiones. Cualquier otro carácter que no sea dígito no entra. */
export function normalizarClabe(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpia = valor.trim().replace(/[\s-]/g, "");
  if (!/^[0-9]{18}$/.test(limpia)) return null;
  return limpia;
}

export function digitoClabe(primerosDiecisiete: string): number | null {
  if (!/^[0-9]{17}$/.test(primerosDiecisiete)) return null;
  let suma = 0;
  for (let indice = 0; indice < PESOS_CLABE.length; indice += 1) {
    const digito = primerosDiecisiete.charCodeAt(indice) - 48;
    const peso = PESOS_CLABE[indice] ?? 0;
    suma += (digito * peso) % 10;
  }
  return (10 - (suma % 10)) % 10;
}

export function clabeValida(valor: unknown): ClabeResultado {
  const clabe = normalizarClabe(valor);
  if (!clabe) return { ok: false, codigo: "clabe_invalida" };
  const esperado = digitoClabe(clabe.slice(0, 17));
  if (esperado === null || clabe.charCodeAt(17) - 48 !== esperado) {
    return { ok: false, codigo: "clabe_invalida" };
  }
  return { ok: true, clabe };
}

/** Los 18 dígitos, agrupados para leerse, sin ocultar ninguno. */
export function clabeVisible(clabe: string): string {
  return `${clabe.slice(0, 3)} ${clabe.slice(3, 6)} ${clabe.slice(6, 17)} ${clabe.slice(17)}`;
}
