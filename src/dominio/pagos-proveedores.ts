import { leerCentavosEscritos } from "./centavos";

export const ESTADOS_PAGO = ["por_autorizar", "listo_para_pagar", "rechazado", "cancelado"] as const;
export type EstadoPago = (typeof ESTADOS_PAGO)[number];
export type OrigenPago = "cfdi" | "excepcion";

export type ErrorPago =
  | "proveedor_ausente"
  | "monto_invalido"
  | "fecha_invalida"
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

export function fechaValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
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
  return leido.tipo === "centavos" && leido.centavos > 0 ? leido.centavos : null;
}

export function textoPago(valor: unknown, maximo: number, minimo = 1): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().replace(/\s+/g, " ");
  if (limpio.length < minimo || limpio.length > maximo || /[\u0000-\u001f\u007f]/.test(limpio)) return null;
  return limpio;
}

export function correoOpcional(valor: unknown): string | null | "invalido" {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor !== "string") return "invalido";
  const limpio = valor.trim().toLowerCase();
  return limpio.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio) ? limpio : "invalido";
}

export function uuidPago(valor: unknown): valor is string {
  return typeof valor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

export function validarFechasPago(entrada: { emitidaEl: unknown; venceEl: unknown; programadaEl: unknown; hoy: string }): ErrorPago | null {
  if (!fechaValida(entrada.emitidaEl) || !fechaValida(entrada.venceEl) || !fechaValida(entrada.programadaEl)) {
    return "fecha_invalida";
  }
  if (entrada.venceEl < entrada.emitidaEl) return "fecha_invalida";
  if (entrada.programadaEl < entrada.hoy) return "fecha_pasada";
  return null;
}

export function tonoEstado(estado: EstadoPago): "sello" | "aviso" | "neutro" {
  if (estado === "listo_para_pagar") return "sello";
  if (estado === "rechazado") return "aviso";
  return "neutro";
}
