/**
 * Matriz de grado de riesgo de una persona moral (23ª-1, 23ª-2 y 27ª de las
 * disposiciones del art. 124 LACP). Pura: recibe «hoy» y no lee el reloj.
 *
 * Cortes: ≤ 3 bajo, 4 a 7 medio, ≥ 8 alto. La base repite los mismos cortes en
 * kyb_calificaciones_riesgo_corte (0028). Una PEP extranjera (30ª) o una
 * coincidencia exacta con la lista dejan el grado en alto sin importar el puntaje.
 */

export type Nivel = "baja" | "media" | "alta";
export type Pep = "no" | "nacional" | "extranjera";
export type Coincidencias = "ninguna" | "posible" | "exacta";
export type Grado = "bajo" | "medio" | "alto";

export type EntradaRiesgo = {
  /** Riesgo de la actividad o giro, según el manual del oficial de cumplimiento. */
  actividad: Nivel;
  /** Riesgo de la zona geográfica del domicilio y de la operación. */
  zona: Nivel;
  fechaConstitucion: string;
  hoy: string;
  /** Capas de la estructura accionaria: 1 si todos los socios son directos. */
  capas: number;
  pep: Pep;
  volumenMensualCentavos: number;
  coincidencias: Coincidencias;
};

export type Factor = { valor: string | number; puntos: number };

export type Calificacion = {
  puntaje: number;
  grado: Grado;
  factores: Record<"actividad" | "zona" | "antiguedad_meses" | "capas" | "pep" | "volumen_mensual_centavos" | "coincidencias", Factor>;
  revisarAntesDe: string;
};

const PUNTOS_NIVEL: Record<Nivel, number> = { baja: 0, media: 2, alta: 4 };
const UN_MILLON_CENTAVOS = 100_000_000;
const DIEZ_MILLONES_CENTAVOS = 1_000_000_000;

export function calificarRiesgo(entrada: EntradaRiesgo): Calificacion {
  const meses = mesesCompletos(entrada.fechaConstitucion, entrada.hoy);
  const factores: Calificacion["factores"] = {
    actividad: { valor: entrada.actividad, puntos: PUNTOS_NIVEL[entrada.actividad] },
    zona: { valor: entrada.zona, puntos: PUNTOS_NIVEL[entrada.zona] },
    antiguedad_meses: { valor: meses, puntos: meses < 12 ? 2 : meses < 36 ? 1 : 0 },
    capas: { valor: entrada.capas, puntos: entrada.capas >= 3 ? 2 : entrada.capas === 2 ? 1 : 0 },
    pep: { valor: entrada.pep, puntos: entrada.pep === "no" ? 0 : 3 },
    volumen_mensual_centavos: {
      valor: entrada.volumenMensualCentavos,
      puntos: entrada.volumenMensualCentavos >= DIEZ_MILLONES_CENTAVOS ? 2 : entrada.volumenMensualCentavos >= UN_MILLON_CENTAVOS ? 1 : 0,
    },
    coincidencias: { valor: entrada.coincidencias, puntos: entrada.coincidencias === "ninguna" ? 0 : 3 },
  };
  const puntaje = Object.values(factores).reduce((suma, factor) => suma + factor.puntos, 0);
  const forzadoAlto = entrada.pep === "extranjera" || entrada.coincidencias === "exacta";
  return { puntaje, grado: forzadoAlto ? "alto" : gradoDePuntaje(puntaje), factores, revisarAntesDe: sumarMeses(entrada.hoy, 6) };
}

export function gradoDePuntaje(puntaje: number): Grado {
  if (puntaje >= 8) return "alto";
  if (puntaje >= 4) return "medio";
  return "bajo";
}

/** 27ª: dos evaluaciones por año calendario. Vencida si hoy ya pasó la fecha límite. */
export function revisionVencida(revisarAntesDe: string, hoy: string): boolean {
  return hoy > revisarAntesDe;
}

/** Igual que `fecha + interval 'n months'` de Postgres: el día se ajusta al último del mes. */
export function sumarMeses(fecha: string, meses: number): string {
  const [anio, mes, dia] = partes(fecha);
  const total = anio * 12 + (mes - 1) + meses;
  const anioNuevo = Math.floor(total / 12);
  const mesNuevo = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(anioNuevo, mesNuevo, 0)).getUTCDate();
  return `${String(anioNuevo).padStart(4, "0")}-${String(mesNuevo).padStart(2, "0")}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

export function mesesCompletos(desde: string, hasta: string): number {
  const [a1, m1, d1] = partes(desde);
  const [a2, m2, d2] = partes(hasta);
  const meses = (a2 - a1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, meses);
}

function partes(fecha: string): [number, number, number] {
  const coincide = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!coincide) throw new Error("fecha_invalida");
  return [Number(coincide[1]), Number(coincide[2]), Number(coincide[3])];
}

export const ETIQUETA_GRADO: Record<Grado, string> = { bajo: "Bajo", medio: "Medio", alto: "Alto" };
export const ETIQUETA_NIVEL: Record<Nivel, string> = { baja: "Baja", media: "Media", alta: "Alta" };
