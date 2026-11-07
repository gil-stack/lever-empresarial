import { fechaValida } from "../personas";

/**
 * Aritmética de fechas civiles (YYYY-MM-DD) del flujo. La única pregunta que
 * depende de la zona es «qué día es hoy en México», y la responde
 * `hoyEnMexico` (dominio/personas, el mismo ayudante que usa Inicio). Todo lo
 * demás son fechas sin hora: programada_el, proximo_pago_en, fecha_probable.
 * Por eso la semana de lunes a domingo no se mueve con la zona del servidor.
 */

export const FRECUENCIAS_OBLIGACION = ["semanal", "mensual", "bimestral", "trimestral", "anual"] as const;
export type FrecuenciaObligacion = (typeof FRECUENCIAS_OBLIGACION)[number];

const DIA_MS = 86_400_000;
/**
 * Tope de vueltas por serie. Con `adelantar`, la serie arranca a un periodo de
 * `desde`, así que el tope solo cuida contra un ciclo sin fin.
 */
const TOPE_OCURRENCIAS = 600;

export function exigirFecha(fecha: string): string {
  if (!fechaValida(fecha)) throw new Error("fecha_invalida");
  return fecha;
}

function aUtc(fecha: string): number {
  return Date.parse(`${exigirFecha(fecha)}T00:00:00.000Z`);
}

function deUtc(milisegundos: number): string {
  return new Date(milisegundos).toISOString().slice(0, 10);
}

export function desplazar(fecha: string, dias: number): string {
  if (!Number.isInteger(dias)) throw new Error("fecha_invalida");
  return deUtc(aUtc(fecha) + dias * DIA_MS);
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / DIA_MS);
}

/** El lunes de la semana de esa fecha (semana de lunes a domingo). */
export function lunesDe(fecha: string): string {
  const diaSemana = new Date(aUtc(fecha)).getUTCDay(); // 0 domingo … 6 sábado
  return desplazar(fecha, -((diaSemana + 6) % 7));
}

export function primeroDelMes(fecha: string): string {
  return `${exigirFecha(fecha).slice(0, 7)}-01`;
}

export function ultimoDelMes(fecha: string): string {
  const [anio, mes] = exigirFecha(fecha).split("-").map(Number) as [number, number];
  return deUtc(Date.UTC(anio, mes, 0));
}

function sumarMeses(fecha: string, meses: number, anclaDia: number): string {
  const [anio, mes] = exigirFecha(fecha).split("-").map(Number) as [number, number];
  const indice = mes - 1 + meses;
  const anioDestino = anio + Math.floor(indice / 12);
  const mesDestino = ((indice % 12) + 12) % 12;
  const diasDelMes = new Date(Date.UTC(anioDestino, mesDestino + 1, 0)).getUTCDate();
  return deUtc(Date.UTC(anioDestino, mesDestino, Math.min(anclaDia, diasDelMes)));
}

/** La fecha siguiente de una obligación. El ancla conserva el día original: 31 → 28 de febrero → 31 de marzo. */
export function siguienteObligacion(fecha: string, frecuencia: FrecuenciaObligacion, anclaDia: number): string {
  if (frecuencia === "semanal") return desplazar(fecha, 7);
  const meses = { mensual: 1, bimestral: 2, trimestral: 3, anual: 12 }[frecuencia];
  return sumarMeses(fecha, meses, anclaDia);
}

function mesesEntre(desde: string, hasta: string): number {
  const [a1, m1] = exigirFecha(desde).split("-").map(Number) as [number, number];
  const [a2, m2] = exigirFecha(hasta).split("-").map(Number) as [number, number];
  return (a2 - a1) * 12 + (m2 - m1);
}

/** Un punto de una serie semanal a menos de dos semanas antes de `desde`, sin recorrerla. */
export function adelantarSemanal(base: string, desde: string): string {
  const semanas = Math.floor(diasEntre(base, desde) / 7) - 1;
  return semanas > 0 ? desplazar(base, semanas * 7) : base;
}

/** Igual, para una serie de cada `meses` meses con su día ancla (31 → 28 de febrero → 31 de marzo). */
export function adelantarMeses(base: string, desde: string, meses: number, anclaDia: number): string {
  const pasos = Math.floor(mesesEntre(base, desde) / meses) - 1;
  return pasos > 0 ? sumarMeses(base, pasos * meses, anclaDia) : base;
}

/** El punto de partida de una obligación vieja: un periodo antes de `desde`. */
export function adelantarObligacion(base: string, desde: string, frecuencia: FrecuenciaObligacion, anclaDia: number): string {
  if (frecuencia === "semanal") return adelantarSemanal(base, desde);
  return adelantarMeses(base, desde, { mensual: 1, bimestral: 2, trimestral: 3, anual: 12 }[frecuencia], anclaDia);
}

/**
 * Quincenal (15 y último día): desde el segundo pago la serie pasa por cada
 * día 15, así que el 15 del mes anterior a `desde` está en ella.
 */
export function adelantarQuincenal(base: string, desde: string): string {
  if (mesesEntre(base, desde) < 2) return base;
  return sumarMeses(`${exigirFecha(desde).slice(0, 7)}-15`, -1, 15);
}

/**
 * Las fechas de una serie entre `desde` y `hasta` (ambas incluidas), a partir
 * de su fecha base. Una base vieja avanza hasta la ventana: `adelantar` salta
 * aritméticamente a un punto de la serie cercano a `desde`, así una base de
 * hace años no se queda sin ocurrencias por el tope. Nunca cuenta dos veces ni
 * se queda en un ciclo sin fin.
 */
export function fechasDeSerie(
  base: string,
  siguiente: (fecha: string) => string,
  desde: string,
  hasta: string,
  adelantar?: (base: string, desde: string) => string,
): string[] {
  const fechas: string[] = [];
  let actual = exigirFecha(adelantar && base < desde ? adelantar(base, desde) : base);
  for (let vuelta = 0; vuelta < TOPE_OCURRENCIAS && actual <= hasta; vuelta += 1) {
    if (actual >= desde) fechas.push(actual);
    const proxima = siguiente(actual);
    if (proxima <= actual) throw new Error("serie_sin_avance");
    actual = proxima;
  }
  return fechas;
}

/** «15 de noviembre» o «15 nov 2026» sin depender de la zona del navegador. */
export function fechaCorta(fecha: string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(aUtc(fecha)))
    .replace(".", "");
}

export function fechaConAnio(fecha: string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(aUtc(fecha)));
}

export function nombreDelMes(fecha: string): string {
  const texto = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(aUtc(primeroDelMes(fecha))));
  return texto.charAt(0).toLocaleUpperCase("es-MX") + texto.slice(1);
}
