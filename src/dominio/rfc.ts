const DICCIONARIO = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ";
const GENERICOS = new Set(["XAXX010101000", "XEXX010101000"]);
const MORAL = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
const FISICA = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
const DIAS_POR_MES = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type TipoPersona = "fisica" | "moral";

export type MotivoRfc =
  | "vacio"
  | "longitud"
  | "patron"
  | "fecha"
  | "digito"
  | "generico";

export function normalizarRfc(valor: string): string {
  return valor.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
}

export function tipoDeRfc(valor: string): TipoPersona | null {
  const rfc = normalizarRfc(valor);
  if (MORAL.test(rfc)) return "moral";
  if (FISICA.test(rfc)) return "fisica";
  return null;
}

export function validarRfc(valor: string): MotivoRfc | null {
  const rfc = normalizarRfc(valor);
  if (rfc.length === 0) return "vacio";
  if (GENERICOS.has(rfc)) return "generico";
  if (rfc.length !== 12 && rfc.length !== 13) return "longitud";

  const tipo = tipoDeRfc(rfc);
  if (!tipo) return "patron";
  if (!fechaValida(rfc, tipo)) return "fecha";
  if (!digitoCoincide(rfc)) return "digito";
  return null;
}

function fechaValida(rfc: string, tipo: TipoPersona): boolean {
  const inicio = tipo === "moral" ? 3 : 4;
  const mes = Number(rfc.slice(inicio + 2, inicio + 4));
  const dia = Number(rfc.slice(inicio + 4, inicio + 6));
  const tope = DIAS_POR_MES[mes];
  if (!tope) return false;
  return dia >= 1 && dia <= tope;
}

function digitoCoincide(rfc: string): boolean {
  const cuerpo = rfc.slice(0, -1);
  const esperado = digitoVerificador(cuerpo);
  return esperado !== "" && rfc.endsWith(esperado);
}

/**
 * Dígito verificador público del RFC.
 * Persona física: módulo 11 sobre 12 posiciones.
 * Persona moral: el mismo cálculo, con el ajuste de 481
 * que compensa la posición que la clave moral no trae.
 */
function digitoVerificador(cuerpo: string): string {
  let suma = cuerpo.length === 12 ? 0 : 481;
  for (let i = 0; i < cuerpo.length; i++) {
    const valor = DICCIONARIO.indexOf(cuerpo[i] ?? "");
    if (valor < 0) return "";
    suma += valor * (cuerpo.length + 1 - i);
  }
  const esperado = 11 - (suma % 11);
  if (esperado === 11) return "0";
  if (esperado === 10) return "A";
  return String(esperado);
}
