/**
 * RFC y código postal de la empresa, fase 1.
 *
 * El alta pide RFC de 12 o 13 caracteres con patrón válido. Doce es persona
 * moral; trece es persona física y también entra. «Una razón social» es una
 * empresa por cuenta, no un rechazo del RFC de trece.
 *
 * El patrón es `t_RFC` de tdCFDI.xsd del SAT: letras A-Z, & y Ñ, fecha
 * AAMMDD (mes 01-12, día 01-31) y homoclave [A-Z0-9]{2}[0-9A]. El día no se
 * cruza con el mes: así valida el SAT el XML. No se calcula el dígito de la
 * homoclave; esta fase pide el patrón, y el SAT ha emitido RFC que no lo cumplen.
 */

export type TipoDeRfc = "moral" | "fisica";

export type ErrorDeRfc = "rfc_requerido" | "rfc_longitud" | "rfc_patron";

export type ResultadoRfc =
  | { ok: true; rfc: string; tipo: TipoDeRfc }
  | { ok: false; error: ErrorDeRfc };

export type ErrorDeCodigoPostal =
  | "codigo_postal_requerido"
  | "codigo_postal_patron";

export type ResultadoCodigoPostal =
  | { ok: true; codigoPostal: string }
  | { ok: false; error: ErrorDeCodigoPostal };

const LETRAS = "[A-Z&Ñ]";
const FECHA = "[0-9]{2}(?:0[1-9]|1[012])(?:0[1-9]|[12][0-9]|3[01])";
const HOMOCLAVE = "[A-Z0-9]{2}[0-9A]";

const PATRON_MORAL = new RegExp(`^${LETRAS}{3}${FECHA}${HOMOCLAVE}$`, "u");
const PATRON_FISICA = new RegExp(`^${LETRAS}{4}${FECHA}${HOMOCLAVE}$`, "u");
const PATRON_CODIGO_POSTAL = /^[0-9]{5}$/u;

function recortar(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  return entrada.trim();
}

function tipoDeRfc(longitud: number): TipoDeRfc | null {
  if (longitud === 12) return "moral";
  if (longitud === 13) return "fisica";
  return null;
}

/** Normaliza y valida el RFC de la empresa. Devuelve el valor en mayúsculas. */
export function validarRfc(entrada: unknown): ResultadoRfc {
  const crudo = recortar(entrada);
  if (crudo === null || crudo.length === 0) {
    return { ok: false, error: "rfc_requerido" };
  }

  const rfc = crudo.toUpperCase();
  const tipo = tipoDeRfc(rfc.length);
  if (tipo === null) {
    return { ok: false, error: "rfc_longitud" };
  }

  const patron = tipo === "moral" ? PATRON_MORAL : PATRON_FISICA;
  if (!patron.test(rfc)) {
    return { ok: false, error: "rfc_patron" };
  }

  return { ok: true, rfc, tipo };
}

/**
 * Código postal mexicano de exactamente cinco dígitos, conservado como texto
 * para no perder el cero a la izquierda. Esta fase no consulta SEPOMEX.
 */
export function validarCodigoPostal(entrada: unknown): ResultadoCodigoPostal {
  const codigoPostal = recortar(entrada);
  if (codigoPostal === null || codigoPostal.length === 0) {
    return { ok: false, error: "codigo_postal_requerido" };
  }
  if (!PATRON_CODIGO_POSTAL.test(codigoPostal)) {
    return { ok: false, error: "codigo_postal_patron" };
  }
  return { ok: true, codigoPostal };
}
