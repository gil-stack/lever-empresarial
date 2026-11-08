/**
 * Formato oficial de reportes de Operaciones Relevantes, Inusuales y Preocupantes
 * (resolución del DOF del 14-12-2004 y sus reformas, Anexo 1): 41 columnas, cada
 * una terminada con «;», todo en mayúsculas. Lever arma el contenido; lo envía el
 * Oficial de Cumplimiento por el SITI PLD/FT. Lever no transmite.
 */

export const COLUMNAS = 41;

/** Las columnas que Lever llena. Las demás las completa el Oficial con los catálogos de la CNBV. */
export const NOMBRE_COLUMNA: Readonly<Record<number, string>> = {
  1: "Tipo de reporte",
  2: "Periodo del reporte",
  3: "Folio",
  4: "Órgano supervisor (clave CASFIM)",
  5: "Clave del sujeto obligado (clave CASFIM)",
  40: "Descripción de la operación",
  41: "Razones por las que se considera inusual o preocupante",
};

export const LEYENDA_24_HORAS = "REPORTE DE 24 HORAS";

/**
 * Un campo del layout: sin «;» (es el separador), sin saltos de línea y en
 * mayúsculas. El Anexo pide evitar el separador dentro de los textos.
 */
export function campo41(valor: string): string {
  return valor
    .replace(/[;\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("es-MX");
}

/** Un renglón: 41 campos, cada uno terminado con «;». Un campo vacío deja los «;» seguidos. */
export function renglon41(campos: Readonly<Record<number, string>>): string {
  let salida = "";
  for (let columna = 1; columna <= COLUMNAS; columna++) {
    salida += `${campo41(campos[columna] ?? "")};`;
  }
  return salida;
}

/** Claves CASFIM de 6 dígitos (columnas 4 y 5). */
export function claveCasfimValida(valor: string): boolean {
  return /^[0-9]{6}$/.test(valor);
}

/**
 * 36ª, segundo párrafo, y art. 2 de la resolución: sin operaciones relevantes en
 * el periodo, el reporte va vacío, con solo el tipo (1), el periodo (AAAAMM) y la
 * identificación de la entidad (columnas 4 y 5). Borrador: la mecánica exacta del
 * reporte vacío en el SITI la confirma el Oficial.
 */
export function relevantesVacio(entrada: { periodo: string; organoSupervisor: string; claveEntidad: string }): string {
  if (!/^\d{6}$/.test(entrada.periodo)) throw new Error("periodo_invalido");
  if (!claveCasfimValida(entrada.organoSupervisor) || !claveCasfimValida(entrada.claveEntidad)) throw new Error("clave_invalida");
  return `${renglon41({ 1: "1", 2: entrada.periodo, 4: entrada.organoSupervisor, 5: entrada.claveEntidad })}\r\n`;
}

/**
 * 40ª y 45ª: el renglón de la operación principal de un reporte de Inusual (2) o
 * Interna Preocupante (3). Periodo AAAAMMDD. La 44ª pide la leyenda «Reporte de 24
 * horas» en la descripción (columna 40). La columna 34 de la operación principal
 * lleva «00» (Anexo 1, nota).
 */
export function renglonInusual(entrada: {
  tipo: "2" | "3";
  periodo: string;
  folio: number;
  organoSupervisor: string | null;
  claveEntidad: string | null;
  descripcion: string;
  razones: string;
  veinticuatroHoras: boolean;
}): string {
  if (!/^\d{8}$/.test(entrada.periodo)) throw new Error("periodo_invalido");
  const descripcion = entrada.veinticuatroHoras ? `${LEYENDA_24_HORAS}. ${entrada.descripcion}` : entrada.descripcion;
  return renglon41({
    1: entrada.tipo,
    2: entrada.periodo,
    3: String(entrada.folio).padStart(6, "0"),
    4: entrada.organoSupervisor ?? "",
    5: entrada.claveEntidad ?? "",
    34: "00",
    40: descripcion,
    41: entrada.razones,
  });
}
