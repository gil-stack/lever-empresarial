import { leerCentavosEscritos } from "../centavos";

/** Tope de la mensualidad: $1,000,000,000.00. Coincide con el CHECK `billing_plans_mensualidad` (0046). */
export const MENSUALIDAD_MAXIMA_CENTAVOS = 100_000_000_000;
/** Tope del costo por SPEI: $100,000.00. Coincide con el CHECK `billing_plans_spei` (0046). */
export const SPEI_MAXIMO_CENTAVOS = 10_000_000;

export type PlanNormalizado = { nombre: string; mensualidadCentavos: number; speiCentavos: number };

/** Lo que escribe la persona en pesos (con o sin «$», comas y centavos) a centavos enteros. */
export function normalizarPlan(entrada: { nombre?: unknown; mensualidad?: unknown; spei?: unknown }): PlanNormalizado {
  const nombre = typeof entrada.nombre === "string" ? entrada.nombre.trim().replace(/\s+/g, " ") : "";
  if (nombre.length < 1 || [...nombre].length > 60 || /[\p{Cc}\p{Cf}]/u.test(nombre)) throw new Error("plan_nombre_invalido");
  const mensualidad = leerCentavosEscritos(entrada.mensualidad);
  if (mensualidad.tipo !== "centavos" || mensualidad.centavos > MENSUALIDAD_MAXIMA_CENTAVOS) {
    throw new Error("plan_mensualidad_invalida");
  }
  const spei = leerCentavosEscritos(entrada.spei);
  if (spei.tipo !== "centavos" || spei.centavos > SPEI_MAXIMO_CENTAVOS) throw new Error("plan_spei_invalido");
  return { nombre, mensualidadCentavos: mensualidad.centavos, speiCentavos: spei.centavos };
}

/** Centavos a lo que se escribe en el campo: «1500.00». */
export function pesosParaCampo(centavos: number): string {
  return `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}

export type CobroCalculado = { speiCentavosTotal: number; totalCentavos: number };

/** Mensualidad del plan más cada SPEI por su costo. Sin plan no hay mensualidad, pero los SPEI se siguen contando. */
export function calcularCobro(entrada: { mensualidadCentavos: number; speiCentavos: number; spei: number }): CobroCalculado {
  const { mensualidadCentavos, speiCentavos, spei } = entrada;
  for (const valor of [mensualidadCentavos, speiCentavos, spei]) {
    if (!Number.isSafeInteger(valor) || valor < 0) throw new Error("cobro_invalido");
  }
  const speiCentavosTotal = speiCentavos * spei;
  const totalCentavos = mensualidadCentavos + speiCentavosTotal;
  if (!Number.isSafeInteger(totalCentavos)) throw new Error("cobro_invalido");
  return { speiCentavosTotal, totalCentavos };
}

export type Periodo = { mes: string; desde: string; hasta: string; ultimoDia: string };

/**
 * El mes de cobro en hora de la Ciudad de México (UTC-6 todo el año desde 2022): del día 1 a las 00:00 al día 1 del
 * mes siguiente, sin incluirlo. Un mes mal escrito vuelve al mes de `hoy`.
 */
export function periodoDeMes(mes: unknown, hoy: string): Periodo {
  const valido = typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) && mes >= "2020-01" && mes <= "2100-12";
  const elegido = valido ? (mes as string) : hoy.slice(0, 7);
  const [año, numero] = elegido.split("-").map(Number) as [number, number];
  const siguiente = numero === 12 ? `${año + 1}-01` : `${año}-${String(numero + 1).padStart(2, "0")}`;
  const ultimo = new Date(Date.UTC(año, numero, 0)).getUTCDate();
  return {
    mes: elegido,
    desde: `${elegido}-01T00:00:00-06:00`,
    hasta: `${siguiente}-01T00:00:00-06:00`,
    ultimoDia: `${elegido}-${String(ultimo).padStart(2, "0")}`,
  };
}

/** «noviembre de 2026». */
export function nombreDelMes(mes: string): string {
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-01T12:00:00Z`));
}
