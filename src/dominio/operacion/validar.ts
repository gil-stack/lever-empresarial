import { sinControles } from "../control";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidValido(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/**
 * «AAAA-MM-DD» que existe en el calendario, del año 1 en adelante, como el tipo `date` de la base: el
 * 2026-02-30 o el año 0 tienen la forma pero la base los rechaza (22008).
 */
export function fechaDeCalendario(valor: string): boolean {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!partes) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  if (anio < 1 || mes < 1 || mes > 12 || dia < 1) return false;
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
  return dia <= [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]!;
}

export function textoOperativo(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string") return null;
  const limpio = sinControles(valor).trim().replace(/\s+/g, " ");
  // Caracteres, no unidades UTF-16, como `char_length` en los CHECK.
  return limpio.length > 0 && [...limpio].length <= maximo ? limpio : null;
}

/**
 * Lo escrito en un `textarea` (motivos y detalles). Se acepta en varios renglones, pero se guarda en uno:
 * los CHECK de la base (`[[:cntrl:]]` y `texto_regulado`) no aceptan saltos de línea ni tabuladores.
 * `sinControles` vuelve un espacio cada salto y cada control invisible, y junta los espacios.
 */
export function textoMultilinea(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string") return null;
  const limpio = sinControles(valor);
  return limpio.length > 0 && [...limpio].length <= maximo ? limpio : null;
}
