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
/** Un año de una obligación semanal y una década de una anual: la recurrencia no recorre más. */
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

/**
 * Las fechas de una serie entre `desde` y `hasta` (ambas incluidas), a partir
 * de su fecha base. Una base vieja avanza hasta la ventana; nunca cuenta dos
 * veces ni se queda en un ciclo sin fin.
 */
export function fechasDeSerie(
  base: string,
  siguiente: (fecha: string) => string,
  desde: string,
  hasta: string,
): string[] {
  const fechas: string[] = [];
  let actual = exigirFecha(base);
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
