import { desplazar, diasEntre, exigirFecha, sumarMeses } from "../flujo/fechas";

/**
 * Periodos de un plan de cobranza. Cada vencimiento sale del primero, nunca del
 * anterior: con ancla 31, enero 31 → febrero 28 (29 en bisiesto) → marzo 31 →
 * abril 30. Así un mes corto no arrastra el día a los meses siguientes.
 */

export const PERIODICIDADES = ["mensual", "bimestral", "trimestral", "semestral", "anual"] as const;
export type Periodicidad = (typeof PERIODICIDADES)[number];

export const MESES_DE: Readonly<Record<Periodicidad, number>> = {
  mensual: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

export const ETIQUETA_PERIODICIDAD: Readonly<Record<Periodicidad, string>> = {
  mensual: "Mensual",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

export function esPeriodicidad(valor: unknown): valor is Periodicidad {
  return typeof valor === "string" && (PERIODICIDADES as readonly string[]).includes(valor);
}

export type PlanDePeriodos = {
  primerVencimiento: string;
  periodicidad: Periodicidad;
  fin: string | null;
};

/** El día del primer vencimiento es el ancla de toda la serie. */
export function anclaDe(primerVencimiento: string): number {
  return Number(exigirFecha(primerVencimiento).slice(8, 10));
}

/** El vencimiento del periodo `n` (0 es el primero). */
export function vencimientoDe(plan: Pick<PlanDePeriodos, "primerVencimiento" | "periodicidad">, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("periodo_invalido");
  if (n === 0) return exigirFecha(plan.primerVencimiento);
  return sumarMeses(plan.primerVencimiento, n * MESES_DE[plan.periodicidad], anclaDe(plan.primerVencimiento));
}

/** Los primeros `cuantos` vencimientos desde el periodo `desde`, sin pasar del fin del plan. */
export function calendario(plan: PlanDePeriodos, cuantos: number, desde = 0): { periodo: number; vencimiento: string }[] {
  const lista: { periodo: number; vencimiento: string }[] = [];
  for (let n = desde; lista.length < cuantos; n += 1) {
    const vencimiento = vencimientoDe(plan, n);
    if (plan.fin && vencimiento > plan.fin) break;
    lista.push({ periodo: n, vencimiento });
  }
  return lista;
}

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;
const MES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

/**
 * Lo que cubre un cargo: el mes de su vencimiento y los que siguen hasta
 * completar el periodo. «noviembre 2026»; «nov – dic 2026»; «dic 2026 – feb 2027».
 */
export function etiquetaPeriodo(vencimiento: string, periodicidad: Periodicidad | null): string {
  const [anio, mes] = exigirFecha(vencimiento).split("-").map(Number) as [number, number];
  const meses = periodicidad ? MESES_DE[periodicidad] : 1;
  if (meses === 1) return `${MES_LARGO[mes - 1]} ${anio}`;
  const indiceFin = mes - 1 + meses - 1;
  const anioFin = anio + Math.floor(indiceFin / 12);
  const mesFin = (indiceFin % 12) + 1;
  const inicio = MES_CORTO[mes - 1];
  const final = MES_CORTO[mesFin - 1];
  return anioFin === anio ? `${inicio} – ${final} ${anio}` : `${inicio} ${anio} – ${final} ${anioFin}`;
}

export type PeriodoPorGenerar = { periodo: number; vencimiento: string; omitido: boolean };

/** Tope de periodos por plan en una corrida: una base vieja no genera un ciclo sin fin. */
export const TOPE_POR_CORRIDA = 24;

/**
 * Los periodos que faltan por generar hoy: los que siguen al último generado,
 * con vencimiento hasta `hoy + emitirDiasAntes` y sin pasar del fin. Los que
 * vencieron antes de reanudar una pausa se generan como omitidos (no se cobran,
 * pero quedan en el calendario).
 */
export function periodosPorGenerar(
  plan: PlanDePeriodos & { reanudadoEl: string | null },
  siguiente: number,
  hoy: string,
  emitirDiasAntes: number,
): PeriodoPorGenerar[] {
  const horizonte = desplazar(hoy, emitirDiasAntes);
  const lista: PeriodoPorGenerar[] = [];
  for (let n = siguiente; lista.length < TOPE_POR_CORRIDA; n += 1) {
    const vencimiento = vencimientoDe(plan, n);
    if (vencimiento > horizonte || (plan.fin && vencimiento > plan.fin)) break;
    lista.push({ periodo: n, vencimiento, omitido: plan.reanudadoEl !== null && vencimiento < plan.reanudadoEl });
  }
  return lista;
}

/** Días de atraso de un cargo (0 si todavía no vence). */
export function diasDeAtraso(vencimiento: string, hoy: string): number {
  return Math.max(0, diasEntre(vencimiento, hoy));
}
