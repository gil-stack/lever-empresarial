/**
 * Una sola escritura de la hora, en el centro de México.
 * La ficha, la lista 69-B y la vigencia de la CLABE usan esta frase.
 */

const FORMATO = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function horaEnMexico(instante: Date): string {
  if (Number.isNaN(instante.getTime())) return "";
  const partes = FORMATO.formatToParts(instante);
  const tomar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";
  const hora = tomar("hour").replace(/\D/g, "").padStart(2, "0");
  const minuto = tomar("minute").replace(/\D/g, "").padStart(2, "0");
  return `${tomar("day")} de ${tomar("month")} de ${tomar("year")} a las ${hora}:${minuto}, hora del centro de México`;
}
