import { leerCentavosEscritos } from "../centavos";
import { fechaValida } from "../personas";
import { normalizarRfc, validarRfc } from "../rfc";
import { FRECUENCIAS_OBLIGACION, type FrecuenciaObligacion } from "./fechas";
import { sinControles } from "../control";

/**
 * Lo que la persona escribe en los formularios del flujo, ya validado. Los
 * montos pasan por el mismo lector de pesos del resto de la plataforma
 * (`leerCentavosEscritos`): centavos enteros, nunca flotantes.
 */

export type ErrorFlujo = { campo: string; mensaje: string };

export type EstadoFlujo =
  | { tipo: "inicial" }
  | { tipo: "invalido"; errores: ErrorFlujo[] }
  | { tipo: "rechazado"; titulo: string; mensaje: string }
  | { tipo: "listo"; mensaje: string };

export const ESTADO_FLUJO_INICIAL: EstadoFlujo = { tipo: "inicial" };

type Resultado<T> = { ok: true; valor: T } | { ok: false; errores: ErrorFlujo[] };


export function textoLimpio(valor: unknown, maximo: number, minimo = 1): string | null {
  if (typeof valor !== "string") return null;
  // Sin controles invisibles: se quitan al limpiar, no se rechazan.
  const limpio = sinControles(valor.normalize("NFKC")).trim().replace(/\s+/g, " ");
  // Caracteres, no unidades UTF-16: la base mide con char_length («ok 😀» son 4).
  const largo = [...limpio].length;
  return largo >= minimo && largo <= maximo ? limpio : null;
}

function montoPositivo(valor: unknown): number | null {
  const leido = leerCentavosEscritos(valor);
  return leido.tipo === "centavos" && leido.centavos > 0 && leido.centavos <= 9_000_000_000_000_000 ? leido.centavos : null;
}

function montoNoNegativo(valor: unknown): number | null {
  const leido = leerCentavosEscritos(valor);
  return leido.tipo === "centavos" && leido.centavos <= 9_000_000_000_000_000 ? leido.centavos : null;
}

export function validarSaldo(entrada: { saldo?: unknown; alDia?: unknown }, hoy: string): Resultado<{ centavos: number; alDia: string }> {
  const errores: ErrorFlujo[] = [];
  const centavos = montoNoNegativo(entrada.saldo);
  if (centavos === null) errores.push({ campo: "saldo", mensaje: "Escribe el saldo en pesos, por ejemplo 250000.00." });
  const alDia = fechaValida(entrada.alDia);
  if (!alDia) errores.push({ campo: "alDia", mensaje: "Elige el día del saldo." });
  else if (alDia > hoy) errores.push({ campo: "alDia", mensaje: "El saldo no puede ser de un día que todavía no llega." });
  if (errores.length > 0 || centavos === null || !alDia) return { ok: false, errores };
  return { ok: true, valor: { centavos, alDia } };
}

export function validarColchon(valor: unknown): Resultado<number> {
  const centavos = montoNoNegativo(valor);
  if (centavos === null) return { ok: false, errores: [{ campo: "colchon", mensaje: "Escribe el colchón en pesos; 0 lo quita." }] };
  return { ok: true, valor: centavos };
}

export type CobroManual = {
  clienteNombre: string;
  clienteRfc: string | null;
  concepto: string;
  montoCentavos: number;
  fechaProbable: string;
  referencia: string | null;
};

export function validarCobroManual(entrada: Record<string, unknown>): Resultado<CobroManual> {
  const errores: ErrorFlujo[] = [];
  const clienteNombre = textoLimpio(entrada.clienteNombre, 254);
  if (!clienteNombre) errores.push({ campo: "clienteNombre", mensaje: "Escribe el nombre del cliente." });
  const rfcEscrito = typeof entrada.clienteRfc === "string" ? entrada.clienteRfc.trim().toUpperCase() : "";
  // Se guarda lo que se valida: sin espacios ni guiones, como pide el CHECK de la base. Lo escrito que no
  // queda en un RFC (solo guiones o espacios, por ejemplo) es error de su campo.
  const clienteRfc = rfcEscrito === "" ? null : normalizarRfc(rfcEscrito);
  if (clienteRfc !== null && validarRfc(clienteRfc) !== null) errores.push({ campo: "clienteRfc", mensaje: "Ese RFC no tiene la forma de un RFC. Déjalo vacío si no lo tienes." });
  const concepto = textoLimpio(entrada.concepto, 200);
  if (!concepto) errores.push({ campo: "concepto", mensaje: "Escribe el concepto del cobro." });
  const montoCentavos = montoPositivo(entrada.monto);
  if (montoCentavos === null) errores.push({ campo: "monto", mensaje: "Escribe el monto en pesos, mayor a cero." });
  const fechaProbable = fechaValida(entrada.fechaProbable);
  if (!fechaProbable) errores.push({ campo: "fechaProbable", mensaje: "Elige la fecha probable de cobro." });
  const referenciaEscrita = typeof entrada.referencia === "string" ? entrada.referencia.trim() : "";
  const referencia = referenciaEscrita === "" ? null : textoLimpio(referenciaEscrita, 120);
  if (referenciaEscrita !== "" && !referencia) errores.push({ campo: "referencia", mensaje: "La referencia admite hasta 120 caracteres." });
  if (errores.length > 0 || !clienteNombre || !concepto || montoCentavos === null || !fechaProbable) return { ok: false, errores };
  return { ok: true, valor: { clienteNombre, clienteRfc, concepto, montoCentavos, fechaProbable, referencia } };
}

export function validarFechaProbable(valor: unknown): Resultado<string> {
  const fecha = fechaValida(valor);
  if (!fecha) return { ok: false, errores: [{ campo: "fechaProbableXml", mensaje: "Elige la fecha probable de cobro." }] };
  return { ok: true, valor: fecha };
}

export function validarCobrado(valor: unknown, hoy: string): Resultado<string> {
  const fecha = fechaValida(valor);
  if (!fecha) return { ok: false, errores: [{ campo: "cobradoEl", mensaje: "Elige el día en que llegó el dinero." }] };
  if (fecha > hoy) return { ok: false, errores: [{ campo: "cobradoEl", mensaje: "La fecha de cobro no puede ser futura." }] };
  return { ok: true, valor: fecha };
}

export function validarMotivo(valor: unknown): Resultado<string> {
  const motivo = textoLimpio(valor, 500, 5);
  if (!motivo) return { ok: false, errores: [{ campo: "motivo", mensaje: "Explica el motivo en al menos 5 caracteres." }] };
  return { ok: true, valor: motivo };
}

export type ObligacionEscrita = {
  concepto: string;
  montoCentavos: number;
  frecuencia: FrecuenciaObligacion;
  proximaFecha: string;
  anclaDia: number;
  areaId: string | null;
  /** Quien la factura, si la empresa lo elige: evita contarla dos veces en el mes que ya trae su cargo. */
  proveedorId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarObligacion(entrada: Record<string, unknown>): Resultado<ObligacionEscrita> {
  const errores: ErrorFlujo[] = [];
  const concepto = textoLimpio(entrada.concepto, 120);
  if (!concepto) errores.push({ campo: "concepto", mensaje: "Escribe el concepto, por ejemplo «Renta de oficina»." });
  const montoCentavos = montoPositivo(entrada.monto);
  if (montoCentavos === null) errores.push({ campo: "monto", mensaje: "Escribe el monto en pesos, mayor a cero." });
  const frecuencia = FRECUENCIAS_OBLIGACION.includes(entrada.frecuencia as FrecuenciaObligacion)
    ? (entrada.frecuencia as FrecuenciaObligacion)
    : null;
  if (!frecuencia) errores.push({ campo: "frecuencia", mensaje: "Elige cada cuánto se paga." });
  const proximaFecha = fechaValida(entrada.proximaFecha);
  if (!proximaFecha) errores.push({ campo: "proximaFecha", mensaje: "Elige la próxima fecha de pago." });
  const area = typeof entrada.areaId === "string" ? entrada.areaId.trim() : "";
  if (area !== "" && !UUID.test(area)) errores.push({ campo: "areaId", mensaje: "Elige un área de la lista." });
  const proveedor = typeof entrada.proveedorId === "string" ? entrada.proveedorId.trim() : "";
  if (proveedor !== "" && !UUID.test(proveedor)) errores.push({ campo: "proveedorId", mensaje: "Elige un proveedor de la lista." });
  if (errores.length > 0 || !concepto || montoCentavos === null || !frecuencia || !proximaFecha) return { ok: false, errores };
  return {
    ok: true,
    valor: {
      concepto,
      montoCentavos,
      frecuencia,
      proximaFecha,
      anclaDia: Number(proximaFecha.slice(8, 10)),
      areaId: area === "" ? null : area.toLowerCase(),
      proveedorId: proveedor === "" ? null : proveedor.toLowerCase(),
    },
  };
}

export function uuidValido(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

export const ETIQUETA_FRECUENCIA: Record<FrecuenciaObligacion, string> = {
  semanal: "Cada semana",
  mensual: "Cada mes",
  bimestral: "Cada dos meses",
  trimestral: "Cada tres meses",
  anual: "Cada año",
};

/** El siguiente día 17 desde hoy: la plantilla de impuestos provisionales. */
export function siguienteDia17(hoy: string): string {
  const [anio, mes, dia] = hoy.split("-").map(Number) as [number, number, number];
  if (dia <= 17) return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-17`;
  return mes === 12 ? `${anio + 1}-01-17` : `${anio}-${String(mes + 1).padStart(2, "0")}-17`;
}
