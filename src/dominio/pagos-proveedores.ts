import { leerCentavosEscritos } from "./centavos";
import { INVISIBLE, sinControles } from "./control";
import { fechaDeCalendario } from "./operacion/validar";

export const ESTADOS_PAGO = ["por_autorizar", "listo_para_pagar", "rechazado", "cancelado"] as const;
export type EstadoPago = (typeof ESTADOS_PAGO)[number];
export type OrigenPago = "cfdi" | "excepcion";

export type ErrorPago =
  | "proveedor_ausente"
  | "monto_invalido"
  | "fecha_invalida"
  | "fecha_emision_invalida"
  | "fecha_programada_invalida"
  | "fecha_pasada"
  | "referencia_invalida"
  | "motivo_invalido"
  | "archivo_ausente"
  | "cfdi_invalido"
  | "cfdi_emisor_distinto"
  | "cfdi_receptor_distinto"
  | "cfdi_duplicado"
  | "pago_no_autorizable"
  | "reautenticacion_requerida";

export const ETIQUETA_ESTADO: Record<EstadoPago, string> = {
  por_autorizar: "Por autorizar",
  listo_para_pagar: "Listo para pagar",
  rechazado: "Rechazado",
  cancelado: "Cancelado",
};

export function fechaEnMexico(ahora = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
  const tomar = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${tomar("year")}-${tomar("month")}-${tomar("day")}`;
}

/** Una fecha que existe en el calendario, del año 1 en adelante, como el tipo `date` de la base (sin 22008). */
export function fechaValida(valor: unknown): valor is string {
  return typeof valor === "string" && fechaDeCalendario(valor);
}

export function sumarDias(fecha: string, dias: number): string {
  if (!fechaValida(fecha) || !Number.isInteger(dias) || dias < 0 || dias > 365) throw new Error("fecha_invalida");
  const resultado = new Date(`${fecha}T00:00:00.000Z`);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado.toISOString().slice(0, 10);
}

export function fechaLegible(fecha: string): string {
  if (!fechaValida(fecha)) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${fecha}T00:00:00.000Z`));
}

export function montoEscrito(valor: unknown): number | null {
  const leido = leerCentavosEscritos(valor);
  // Hasta 9e15 centavos, como el CHECK `supplier_payables_total`.
  return leido.tipo === "centavos" && leido.centavos > 0 && leido.centavos <= 9_000_000_000_000_000 ? leido.centavos : null;
}

export function textoPago(valor: unknown, maximo: number, minimo = 1): string | null {
  if (typeof valor !== "string") return null;
  // Sin controles invisibles (se quitan, no se rechazan) y en caracteres, como char_length («Revisar 😀» son 9).
  const limpio = sinControles(valor).trim().replace(/\s+/g, " ");
  const largo = [...limpio].length;
  if (largo < minimo || largo > maximo) return null;
  return limpio;
}

export function correoOpcional(valor: unknown): string | null | "invalido" {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor !== "string") return "invalido";
  const limpio = valor.trim().toLowerCase();
  return limpio.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio) && !INVISIBLE.test(limpio) ? limpio : "invalido";
}

export function uuidPago(valor: unknown): valor is string {
  return typeof valor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

export function validarFechasPago(entrada: { emitidaEl: unknown; venceEl: unknown; programadaEl: unknown; hoy: string }): ErrorPago | null {
  // Cada fecha mala dice cuál es, para marcar su campo: la de la obligación, el vencimiento o la prevista de pago.
  if (!fechaValida(entrada.emitidaEl)) return "fecha_emision_invalida";
  if (!fechaValida(entrada.venceEl) || entrada.venceEl < entrada.emitidaEl) return "fecha_invalida";
  if (!fechaValida(entrada.programadaEl)) return "fecha_programada_invalida";
  if (entrada.programadaEl < entrada.hoy) return "fecha_pasada";
  return null;
}

export function tonoEstado(estado: EstadoPago): "sello" | "aviso" | "neutro" {
  if (estado === "listo_para_pagar") return "sello";
  if (estado === "rechazado") return "aviso";
  return "neutro";
}
