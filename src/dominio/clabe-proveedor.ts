import { capacidadesDe, tiene } from "../nucleo/capacidades";
import { clabeValida, clabeVisible } from "./clabe";
import type { RolCuenta } from "./personas";

/**
 * Catálogo tradicional de la CLABE.
 *
 * La ABM parte la cuenta bancaria en código de banco (3), plaza (3),
 * cuenta (11) y dígito. Esos tres primeros dígitos son los que asigna a
 * una institución de crédito. Esta lista copia las claves 37 y 40 del
 * listado de instituciones del CEP de Banxico, leído el 4 de noviembre
 * de 2026: el código de la CLABE son los tres últimos dígitos y el nombre
 * es el que publica ese listado, sin reescribirlo.
 *
 * Una clave 90 —fondos de pago electrónico, casa de bolsa u otro
 * participante— no entra. Si los tres dígitos no están, no se inventa
 * el nombre.
 */
export const INSTITUCIONES_TRADICIONALES: Readonly<Record<string, string>> = {
  "002": "BANAMEX",
  "006": "BANCOMEXT",
  "009": "BANOBRAS",
  "012": "BBVA MEXICO",
  "014": "SANTANDER",
  "019": "BANJERCITO",
  "021": "HSBC",
  "030": "BAJIO",
  "036": "INBURSA",
  "042": "MIFEL",
  "044": "SCOTIABANK",
  "058": "BANREGIO",
  "059": "INVEX",
  "060": "BANSI",
  "062": "AFIRME",
  "072": "BANORTE",
  "106": "BANK OF AMERICA",
  "108": "MUFG",
  "110": "JP MORGAN",
  "112": "BMONEX",
  "113": "VE POR MAS",
  "124": "CITI MEXICO",
  "127": "AZTECA",
  "128": "KAPITAL",
  "129": "BARCLAYS",
  "130": "COMPARTAMOS",
  "132": "MULTIVA BANCO",
  "133": "ACTINVER",
  "135": "NAFIN",
  "136": "INTERCAM BANCO",
  "137": "BANCOPPEL",
  "138": "UALA",
  "140": "CONSUBANCO",
  "141": "VOLKSWAGEN",
  "145": "BBASE",
  "147": "BANKAOOL",
  "148": "PAGATODO",
  "150": "INMOBILIARIO",
  "151": "DONDE",
  "152": "BANCREA",
  "154": "BANCO COVALTO",
  "155": "ICBC",
  "156": "SABADELL",
  "157": "SHINHAN",
  "158": "MIZUHO BANK",
  "159": "BANK OF CHINA",
  "160": "BANCO S3",
  "166": "BaBien",
  "167": "HEY BANCO",
  "168": "HIPOTECARIA FED",
  "170": "REVOLUT BANK",
  "638": "NUBANK",
};

export const FRASE_INSTITUCION_PENDIENTE =
  "La institución queda pendiente del participante." as const;

export type InstitucionClabe =
  | { conocida: true; nombre: string }
  | { conocida: false; frase: typeof FRASE_INSTITUCION_PENDIENTE };

export type ClabePresentada = {
  clabe: string;
  visible: string;
  codigo: string;
  institucion: InstitucionClabe;
};

export function institucionTradicional(codigo: string): string | null {
  if (!/^[0-9]{3}$/.test(codigo)) return null;
  return INSTITUCIONES_TRADICIONALES[codigo] ?? null;
}

/** Dígito válido, 18 dígitos visibles y el banco solo si el código es tradicional. */
export function presentarClabe(
  valor: unknown,
): { ok: true; clabe: ClabePresentada } | { ok: false; codigo: "clabe_invalida" } {
  const valida = clabeValida(valor);
  if (!valida.ok) return { ok: false, codigo: "clabe_invalida" };
  const codigo = valida.clabe.slice(0, 3);
  const nombre = institucionTradicional(codigo);
  return {
    ok: true,
    clabe: {
      clabe: valida.clabe,
      visible: clabeVisible(valida.clabe),
      codigo,
      institucion: nombre
        ? { conocida: true, nombre }
        : { conocida: false, frase: FRASE_INSTITUCION_PENDIENTE },
    },
  };
}

/** Delegan en la matriz de capacidades. Un rol, no la combinación: la pantalla usa el contexto. */
export function puedeVerClabeProveedor(rol: RolCuenta | null | undefined): boolean {
  return Boolean(rol && tiene(capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] }), "cliente.proveedores.ver"));
}

export function puedeCambiarClabeProveedor(rol: RolCuenta | null | undefined): boolean {
  return Boolean(
    rol && tiene(capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] }), "cliente.proveedores.clabe.cambiar"),
  );
}

export { horaEnMexico as momentoClabe } from "./reloj";
