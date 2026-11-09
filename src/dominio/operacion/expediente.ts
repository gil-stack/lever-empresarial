/**
 * Reglas puras del expediente de persona moral (4ª fr. II de las disposiciones
 * del art. 124 LACP). La base repite cada regla; aquí se valida antes de escribir
 * para devolver un error ligado al campo.
 */

import { tieneAlgoVisible } from "../control";

export const RFC_MORAL = /^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$/;
export const RFC_FISICA = /^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$/;
export const CURP = /^[A-Z]{4}[0-9]{6}[HMX][A-Z]{5}[A-Z0-9][0-9]$/;
export const SERIE_EFIRMA = /^[0-9]{20}$/;

export const TIPOS_DOCUMENTO = [
  "acta_constitutiva",
  "constancia_situacion_fiscal",
  "certificado_efirma",
  "comprobante_domicilio",
  "declaracion_propietarios",
  "identificacion_representante",
  "poder",
  "estructura_corporativa",
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const ETIQUETA_DOCUMENTO: Record<TipoDocumento, string> = {
  acta_constitutiva: "Acta constitutiva inscrita",
  constancia_situacion_fiscal: "Constancia de situación fiscal",
  certificado_efirma: "Constancia de la e.firma",
  comprobante_domicilio: "Comprobante de domicilio",
  declaracion_propietarios: "Declaración de propietarios reales",
  identificacion_representante: "Identificación del representante",
  poder: "Poder del representante",
  estructura_corporativa: "Estructura corporativa interna",
};

/** 4ª fr. II b) y c): lo que el envío exige siempre. La identificación va por representante. */
export const DOCUMENTOS_REQUERIDOS: readonly TipoDocumento[] = [
  "acta_constitutiva",
  "constancia_situacion_fiscal",
  "certificado_efirma",
  "comprobante_domicilio",
  "declaracion_propietarios",
];

export const CARGOS = ["administrador_unico", "consejero", "director_general", "apoderado"] as const;
export type Cargo = (typeof CARGOS)[number];
export const ETIQUETA_CARGO: Record<Cargo, string> = {
  administrador_unico: "Administrador único",
  consejero: "Consejero",
  director_general: "Director general",
  apoderado: "Apoderado",
};

export const PEPS = ["no", "nacional", "extranjera"] as const;
export type PepDeclarada = (typeof PEPS)[number];
export const ETIQUETA_PEP: Record<PepDeclarada, string> = {
  no: "No",
  nacional: "Sí, nacional",
  extranjera: "Sí, extranjera",
};

export const ETIQUETA_MOTIVO_BENEFICIARIO: Record<string, string> = {
  control: "Controla más del 50 % de los votos",
  otros_medios: "Controla por otros medios",
  capital: "25 % o más del capital",
  votos: "25 % o más de los votos",
  administrador: "Administrador (no hay quien llegue al 25 %)",
};

export const ETIQUETA_RESULTADO: Record<string, string> = {
  aprobado: "Aprobado",
  observado: "Observado",
  rechazado: "Rechazado",
};

/** «60», «33.33» o «12,5» a puntos base enteros (10000 = 100 %). Dos decimales como máximo. */
export function porcentajeAPuntosBase(valor: unknown): number | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().replace(",", ".").replace(/\s*%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros, decimales = ""] = limpio.split(".");
  const puntos = Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
  return puntos >= 0 && puntos <= 10000 ? puntos : null;
}

export function puntosBaseATexto(puntos: number): string {
  const enteros = Math.floor(puntos / 100);
  const resto = puntos % 100;
  return resto === 0 ? `${enteros} %` : `${enteros}.${String(resto).padStart(2, "0")} %`;
}

/** Pesos con centavos opcionales («1,250,000.50») a centavos enteros. */
export function pesosACentavos(valor: unknown): number | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().replace(/[$\s]/g, "").replace(/,/g, "");
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(limpio)) return null;
  const [enteros, decimales = ""] = limpio.split(".");
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

export function rfcMoralValido(valor: string): boolean {
  return RFC_MORAL.test(valor);
}

export function rfcFisicaValido(valor: string): boolean {
  return RFC_FISICA.test(valor);
}

export function curpValida(valor: string): boolean {
  return CURP.test(valor);
}

/** 4ª fr. I b) iii: el comprobante vale tres meses desde su emisión (como `+ interval '3 months'`). */
export function vigenciaDeComprobante(emitidoEl: string): string {
  const [anio, mes, dia] = emitidoEl.split("-").map(Number) as [number, number, number];
  const total = anio * 12 + (mes - 1) + 3;
  const anioNuevo = Math.floor(total / 12);
  const mesNuevo = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(anioNuevo, mesNuevo, 0)).getUTCDate();
  return `${anioNuevo}-${String(mesNuevo).padStart(2, "0")}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

/**
 * Lo que la base exige para enviar una versión (CHECK `kyb_versiones_forma`), agrupado como lo ve Originación: cada
 * dato con su etiqueta y las columnas que lo forman. El número interior es opcional; las demás partes del domicilio,
 * no.
 */
export const DATOS_PARA_ENVIAR = [
  { clave: "razonSocial", etiqueta: "la razón social", columnas: ["razon_social"] },
  { clave: "giro", etiqueta: "el giro", columnas: ["giro"] },
  { clave: "nacionalidad", etiqueta: "la nacionalidad", columnas: ["nacionalidad"] },
  { clave: "rfc", etiqueta: "el RFC", columnas: ["rfc"] },
  { clave: "serieEfirma", etiqueta: "la serie de la e.firma", columnas: ["serie_efirma"] },
  {
    clave: "domicilio",
    etiqueta: "el domicilio",
    columnas: ["domicilio_calle", "domicilio_exterior", "domicilio_colonia", "domicilio_municipio", "domicilio_entidad", "domicilio_codigo_postal", "domicilio_pais"],
  },
  { clave: "telefono", etiqueta: "el teléfono", columnas: ["telefono"] },
  { clave: "correo", etiqueta: "el correo", columnas: ["correo"] },
  { clave: "fechaConstitucion", etiqueta: "la fecha de constitución", columnas: ["fecha_constitucion"] },
  { clave: "volumenMensual", etiqueta: "el volumen mensual esperado", columnas: ["volumen_mensual_centavos"] },
] as const;

/** Las claves de los datos que le faltan a una versión para enviarse, en el orden del formulario. */
export function datosQueFaltan(fila: Readonly<Record<string, unknown>>): string[] {
  const falta = (valor: unknown) => valor === null || valor === undefined || (typeof valor === "string" && !tieneAlgoVisible(valor));
  return DATOS_PARA_ENVIAR.filter((dato) => dato.columnas.some((columna) => falta(fila[columna]))).map((dato) => dato.clave);
}

/** «Falta el giro.» o «Faltan el giro y el domicilio.»; null si ninguna clave es conocida (llega por la dirección). */
export function fraseDeLoQueFalta(claves: readonly string[]): string | null {
  const etiquetas = DATOS_PARA_ENVIAR.filter((dato) => claves.includes(dato.clave)).map((dato) => dato.etiqueta);
  if (etiquetas.length === 0) return null;
  const lista = etiquetas.length === 1 ? etiquetas[0] : `${etiquetas.slice(0, -1).join(", ")} y ${etiquetas[etiquetas.length - 1]}`;
  const uno = etiquetas.length === 1;
  return `${uno ? "Falta" : "Faltan"} ${lista}. Captura ${uno ? "ese dato" : "esos datos"} en «Datos generales» y vuelve a enviar.`;
}
