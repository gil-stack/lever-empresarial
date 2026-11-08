/**
 * Fechas de calendario «AAAA-MM-DD» de los plazos de PLD. Los días hábiles los
 * cuenta la base (pld_sumar_dias_habiles, 0030) con el criterio conservador; aquí
 * solo van los periodos: semestres (27ª), trimestres (36ª) y meses (38ª).
 */

export type Semestre = { anio: number; semestre: 1 | 2; inicio: string; fin: string };

function partes(fecha: string): [number, number, number] {
  const coincide = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!coincide) throw new Error("fecha_invalida");
  return [Number(coincide[1]), Number(coincide[2]), Number(coincide[3])];
}

function dosDigitos(valor: number): string {
  return String(valor).padStart(2, "0");
}

/** 27ª: dos evaluaciones por año calendario. Enero-junio y julio-diciembre. */
export function semestreDe(fecha: string): Semestre {
  const [anio, mes] = partes(fecha);
  return mes <= 6
    ? { anio, semestre: 1, inicio: `${anio}-01-01`, fin: `${anio}-06-30` }
    : { anio, semestre: 2, inicio: `${anio}-07-01`, fin: `${anio}-12-31` };
}

export function semestreAnterior(semestre: Semestre): Semestre {
  return semestre.semestre === 2 ? semestreDe(`${semestre.anio}-01-01`) : semestreDe(`${semestre.anio - 1}-07-01`);
}

/** La misma fecha n meses antes; si el día no existe, el último del mes (31-ago menos 6 meses es 28-feb). */
export function restarMeses(fecha: string, meses: number): string {
  const [anio, mes, dia] = partes(fecha);
  const total = anio * 12 + (mes - 1) - meses;
  const nuevoAnio = Math.floor(total / 12);
  const nuevoMes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(nuevoAnio, nuevoMes, 0)).getUTCDate();
  return `${nuevoAnio}-${dosDigitos(nuevoMes)}-${dosDigitos(Math.min(dia, ultimo))}`;
}

/**
 * 27ª: la evaluación cubre a quien celebró su contrato al menos seis meses antes
 * de la evaluación. Sin celebración (nunca activada), no aplica.
 */
export function elegibleParaEvaluar(celebracion: string | null, alDia: string): boolean {
  return celebracion !== null && celebracion <= restarMeses(alDia, 6);
}

/** 36ª: periodo AAAAMM del último mes del trimestre de una fecha. */
export function trimestreDe(fecha: string): string {
  const [anio, mes] = partes(fecha);
  return `${anio}${dosDigitos(Math.ceil(mes / 3) * 3)}`;
}

/** El trimestre anterior a un periodo AAAAMM trimestral. */
export function trimestreAnterior(periodo: string): string {
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(4, 6));
  return mes === 3 ? `${anio - 1}12` : `${anio}${dosDigitos(mes - 3)}`;
}

/** Primer día del mes siguiente a un periodo AAAAMM: el mes de entrega de la 36ª y el de corte de la 38ª. */
export function mesSiguiente(periodo: string): string {
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(4, 6));
  return mes === 12 ? `${anio + 1}-01-01` : `${anio}-${dosDigitos(mes + 1)}-01`;
}

/** Periodo AAAAMM del mes de una fecha (38ª). */
export function mesDe(fecha: string): string {
  const [anio, mes] = partes(fecha);
  return `${anio}${dosDigitos(mes)}`;
}

export function mesAnterior(periodo: string): string {
  const anio = Number(periodo.slice(0, 4));
  const mes = Number(periodo.slice(4, 6));
  return mes === 1 ? `${anio - 1}12` : `${anio}${dosDigitos(mes - 1)}`;
}

/** Primer día del mes de un periodo AAAAMM. */
export function inicioDelPeriodo(periodo: string): string {
  return `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}-01`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «julio a septiembre de 2026» para un trimestre AAAAMM. */
export function nombreTrimestre(periodo: string): string {
  const mes = Number(periodo.slice(4, 6));
  return `${MESES[mes - 3]} a ${MESES[mes - 1]} de ${periodo.slice(0, 4)}`;
}

/** «octubre de 2026» para un mes AAAAMM. */
export function nombreMes(periodo: string): string {
  return `${MESES[Number(periodo.slice(4, 6)) - 1]} de ${periodo.slice(0, 4)}`;
}

/** Días naturales de `desde` a `hasta` (negativo si ya pasó). */
export function diasNaturales(desde: string, hasta: string): number {
  const [a1, m1, d1] = partes(desde);
  const [a2, m2, d2] = partes(hasta);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}
