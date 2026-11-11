// Fecha y hora de la Ciudad de México como las manda un campo datetime-local
// (AAAA-MM-DDTHH:MM), para las pruebas que registran acuses de PLD.
import { hoyEnMexico } from "../../src/dominio/operacion/comisiones.ts";

function enMexico(fecha: Date): string {
  return fecha.toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).slice(0, 16).replace(" ", "T");
}

/**
 * «Hace unos minutos», sin salir del día de hoy en México. Un acuse de hoy no
 * puede ser anterior al dictamen de hoy (0030, acuse_antes_del_dictamen) ni al
 * mínimo del campo (dictaminadoEl T00:00): entre las 00:00 y las 00:0N, restar
 * N minutos cae en el día anterior, así que el valor se queda en las 00:00.
 */
export function minutosAtrasDeHoy(ahora: Date, minutos: number): string {
  const atras = enMexico(new Date(ahora.getTime() - minutos * 60_000));
  const inicio = `${hoyEnMexico(ahora)}T00:00`;
  return atras < inicio ? inicio : atras;
}

/** Milisegundos que faltan para la próxima medianoche de México (UTC−6 todo el año desde 2022). */
export function hastaLaMedianocheDeMexico(ahora: Date): number {
  const manana = new Date(Date.parse(`${hoyEnMexico(ahora)}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return Date.parse(`${manana}T00:00:00-06:00`) - ahora.getTime();
}

/**
 * Una suite que fecha hechos con el «hoy» de su arranque (sesiones, periodos, manifiestos) y otros con la hora de la
 * base (propuestas, documentos) tiene que correr completa dentro de un mismo día de México. Si faltan menos de
 * `margenMs` para la medianoche, espera a que pase. Devuelve lo que esperó.
 */
export async function esperarSiLlegaLaMedianoche(margenMs: number, ahora = new Date()): Promise<number> {
  const falta = hastaLaMedianocheDeMexico(ahora);
  if (falta >= margenMs) return 0;
  const espera = falta + 1_000;
  await new Promise((listo) => setTimeout(listo, espera));
  return espera;
}
