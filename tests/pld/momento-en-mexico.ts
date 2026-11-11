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
