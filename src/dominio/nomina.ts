import { leerCentavosEscritos } from "./centavos";
import { fechaValida, type ErrorCampo } from "./personas";

export const FRECUENCIAS_NOMINA = ["semanal", "quincenal", "mensual"] as const;
export const DESTINOS_NOMINA = ["clabe", "tarjeta"] as const;

export type FrecuenciaNomina = (typeof FRECUENCIAS_NOMINA)[number];
export type DestinoNomina = (typeof DESTINOS_NOMINA)[number];

export type ConfiguracionNomina = {
  netoCentavos: number;
  frecuencia: FrecuenciaNomina;
  proximoPagoEn: string;
  anclaDia: number;
  destino: DestinoNomina;
};

export type EntradaNomina = {
  neto?: unknown;
  frecuencia?: unknown;
  primerPago?: unknown;
  destino?: unknown;
};

export function tieneConfiguracionNomina(entrada: EntradaNomina): boolean {
  return [entrada.neto, entrada.frecuencia, entrada.primerPago, entrada.destino].some(
    (valor) => valor !== undefined,
  );
}

export function validarConfiguracionNomina(
  entrada: EntradaNomina,
  hoy: string,
  altaEn: string,
  pagoAnterior?: string,
): { ok: true; valor: ConfiguracionNomina } | { ok: false; errores: ErrorCampo[] } {
  const errores = erroresDeConfiguracionNomina(entrada, hoy, altaEn, pagoAnterior);
  if (errores.length > 0) return { ok: false, errores };
  const monto = leerCentavosEscritos(entrada.neto);
  const frecuencia = entrada.frecuencia as FrecuenciaNomina;
  const proximoPagoEn = entrada.primerPago as string;
  return {
    ok: true,
    valor: {
      netoCentavos: monto.tipo === "centavos" ? monto.centavos : 0,
      frecuencia,
      proximoPagoEn,
      anclaDia: Number(proximoPagoEn.slice(8, 10)),
      destino: entrada.destino as DestinoNomina,
    },
  };
}

export function erroresDeConfiguracionNomina(
  entrada: EntradaNomina,
  hoy: string,
  altaEn: string,
  pagoAnterior?: string,
): ErrorCampo[] {
  const errores: ErrorCampo[] = [];
  const monto = leerCentavosEscritos(entrada.neto);
  if (monto.tipo !== "centavos" || monto.centavos <= 0) {
    errores.push({ campo: "neto", mensaje: "Escribe el neto que recibirá en cada pago." });
  }
  if (!FRECUENCIAS_NOMINA.includes(entrada.frecuencia as FrecuenciaNomina)) {
    errores.push({ campo: "frecuencia", mensaje: "Elige semanal, quincenal o mensual." });
  }
  if (!DESTINOS_NOMINA.includes(entrada.destino as DestinoNomina)) {
    errores.push({ campo: "destino", mensaje: "Elige CLABE externa o tarjeta de nómina." });
  }
  const primerPago = fechaValida(entrada.primerPago);
  if (!primerPago) {
    errores.push({ campo: "primerPago", mensaje: "Esa fecha de primer pago no existe." });
  } else {
    if (primerPago < hoy && primerPago !== pagoAnterior) {
      errores.push({ campo: "primerPago", mensaje: "El primer pago no puede ser anterior a hoy." });
    }
    if (primerPago < altaEn) {
      errores.push({ campo: "primerPago", mensaje: "El primer pago no puede ser anterior al ingreso." });
    }
    if (entrada.frecuencia === "quincenal" && !esDiaQuincena(primerPago)) {
      errores.push({ campo: "primerPago", mensaje: "La quincena empieza el 15 o el último día del mes." });
    }
  }
  return errores;
}

export function esDiaQuincena(fecha: string): boolean {
  const dia = Number(fecha.slice(8, 10));
  return dia === 15 || dia === diasDelMes(fecha.slice(0, 4), fecha.slice(5, 7));
}

/** El ancla conserva el día mensual original: 31 → 28 de febrero → 31 de marzo. */
export function siguientePago(
  fecha: string,
  frecuencia: FrecuenciaNomina,
  anclaDia = Number(fecha.slice(8, 10)),
): string {
  if (!fechaValida(fecha)) throw new Error("fecha_invalida");
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  if (frecuencia === "semanal") return fechaUtc(anio, mes, dia + 7);
  if (frecuencia === "quincenal") {
    if (dia === 15) return fechaUtc(anio, mes, diasDelMesNumero(anio, mes));
    return mes === 12 ? fechaUtc(anio + 1, 1, 15) : fechaUtc(anio, mes + 1, 15);
  }
  const siguienteMes = mes === 12 ? 1 : mes + 1;
  const siguienteAnio = mes === 12 ? anio + 1 : anio;
  const diaDestino = Math.min(anclaDia, diasDelMesNumero(siguienteAnio, siguienteMes));
  return fechaUtc(siguienteAnio, siguienteMes, diaDestino);
}

/** Estimación mensual para presupuestos; el importe de cada pago nunca se redondea. */
export function mensualEstimado(netoCentavos: number, frecuencia: FrecuenciaNomina): number {
  if (!Number.isSafeInteger(netoCentavos) || netoCentavos < 0) throw new Error("centavos_invalidos");
  const total = frecuencia === "semanal"
    ? Math.round((netoCentavos * 52) / 12)
    : frecuencia === "quincenal"
      ? netoCentavos * 2
      : netoCentavos;
  if (!Number.isSafeInteger(total)) throw new Error("centavos_invalidos");
  return total;
}

export function sumarCentavos(valores: readonly number[]): number {
  let total = 0;
  for (const valor of valores) {
    if (!Number.isSafeInteger(valor)) throw new Error("centavos_invalidos");
    total += valor;
    if (!Number.isSafeInteger(total)) throw new Error("centavos_invalidos");
  }
  return total;
}

export function disponibleParaPlaneacion(
  presupuesto: number | null,
  nominaMensual: number,
  presupuestosIndividuales: number,
): number | null {
  if (presupuesto === null) return null;
  return presupuesto - nominaMensual - presupuestosIndividuales;
}

function fechaUtc(anio: number, mes: number, dia: number): string {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}-${String(fecha.getUTCDate()).padStart(2, "0")}`;
}

function diasDelMes(anioCrudo: string, mesCrudo: string): number {
  return diasDelMesNumero(Number(anioCrudo), Number(mesCrudo));
}

function diasDelMesNumero(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}
