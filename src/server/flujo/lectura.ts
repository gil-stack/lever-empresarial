import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * Lectura estricta de filas: lo que no tiene la forma esperada no se
 * disfraza de cero, se rechaza como base no disponible.
 */

export function registro(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErrorDeDominio("base_no_disponible");
  return valor as Record<string, unknown>;
}

export function lista(valor: unknown): Record<string, unknown>[] {
  if (!Array.isArray(valor)) throw new ErrorDeDominio("base_no_disponible");
  return valor.map(registro);
}

/** Un objeto JSON { "YYYY-MM": centavos } armado por la base. */
export function centavosPorMes(valor: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(registro(valor)).map(([mes, total]) => {
      if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErrorDeDominio("base_no_disponible");
      return [mes, centavos(total)];
    }),
  );
}

export function texto(valor: unknown): string {
  if (typeof valor !== "string") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

export function textoONulo(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : texto(valor);
}

export function centavos(valor: unknown): number {
  const numero = typeof valor === "number" || (typeof valor === "string" && /^-?\d+$/.test(valor)) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(numero)) throw new ErrorDeDominio("base_no_disponible");
  return numero;
}

export function centavosONulo(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : centavos(valor);
}

export function fecha(valor: unknown): string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

export function fechaONula(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : fecha(valor);
}

/** json_agg entrega el instante como texto ISO 8601 con su desfase; pg, como Date. */
export function instante(valor: unknown): string {
  const leido = valor instanceof Date ? valor : typeof valor === "string" ? new Date(valor) : null;
  if (!leido || Number.isNaN(leido.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return leido.toISOString();
}

export function instanteONulo(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : instante(valor);
}

export function entero(valor: unknown): number {
  const numero = centavos(valor);
  if (numero < 0) throw new ErrorDeDominio("base_no_disponible");
  return numero;
}

export function booleano(valor: unknown): boolean {
  if (typeof valor !== "boolean") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

export function unaFila(resultado: { rows: unknown[] }): Record<string, unknown> {
  if (resultado.rows.length !== 1) throw new ErrorDeDominio("base_no_disponible");
  return registro(resultado.rows[0]);
}
