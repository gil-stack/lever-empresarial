import { clabeValida } from "../clabe";
import { leerCentavosEscritos } from "../centavos";
import { desplazar } from "../flujo/fechas";
import { textoLimpio, type ErrorFlujo } from "../flujo/entradas";
import { fechaValida } from "../personas";
import { validarRfc } from "../rfc";
import { esPeriodicidad, type Periodicidad } from "./periodos";

/**
 * Lo que la persona escribe en los formularios de cobranza, ya validado. Cada
 * error nombra su campo (el `name` del formulario) para marcarlo y llevar el
 * foco. Los montos pasan por el lector de pesos de toda la plataforma.
 */

type Resultado<T> = { ok: true; valor: T } | { ok: false; errores: ErrorFlujo[] };

const TOPE_CENTAVOS = 9_000_000_000_000_000;
/** Igual que la base (cobranza_correo_valido): minúsculas, sin espacios ni signos que rompan un encabezado. */
const CORREO = /^[^\s@<>",;:()[\]\\\u0000-\u001f\u007f]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
/** Hasta dos años adelante: un plan no arranca en otra década por un dedo. */
const HORIZONTE_DIAS = 730;

/**
 * El concepto va al asunto y al cuerpo del correo de cobro. Un salto de línea
 * pegado ahí se vuelve un espacio («Servicio\r\nBcc: x» → «Servicio Bcc: x»):
 * ni se pega al texto de al lado ni se rechaza el formulario (r63-N9). Cualquier
 * otro carácter de control sigue rechazándose.
 */
function conceptoLimpio(valor: unknown): string | null {
  return textoLimpio(typeof valor === "string" ? valor.replace(/[\r\n]+/g, " ") : valor, 200);
}

export function correoValido(valor: string): boolean {
  return valor.length <= 254 && valor === valor.toLowerCase() && CORREO.test(valor);
}

function monto(valor: unknown): number | null {
  const leido = leerCentavosEscritos(valor);
  return leido.tipo === "centavos" && leido.centavos > 0 && leido.centavos <= TOPE_CENTAVOS ? leido.centavos : null;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** De uno a tres correos separados por coma, punto y coma, espacio o renglón. */
export function leerCorreos(valor: unknown): { correos: string[]; error: string | null } {
  const crudo = typeof valor === "string" ? valor : "";
  const partes = crudo.split(/[\s,;]+/).map((parte) => parte.trim().toLowerCase()).filter(Boolean);
  if (partes.length === 0) return { correos: [], error: "Escribe al menos un correo de cobranza." };
  if (partes.length > 3) return { correos: [], error: "Caben hasta 3 correos de cobranza." };
  const malo = partes.find((correo) => !correoValido(correo));
  if (malo) return { correos: [], error: `«${malo.slice(0, 80)}» no es un correo válido.` };
  const unicos = [...new Set(partes)];
  return { correos: unicos, error: null };
}

export type ClienteEscrito = { nombre: string; rfc: string | null; correos: string[] };

function validarCliente(entrada: Record<string, unknown>, errores: ErrorFlujo[]): ClienteEscrito | null {
  const nombre = textoLimpio(entrada.nombre, 254);
  if (!nombre) errores.push({ campo: "nombre", mensaje: "Escribe el nombre o la razón social del cliente." });
  const rfcEscrito = texto(entrada.rfc).toUpperCase();
  const rfc = rfcEscrito === "" ? null : rfcEscrito;
  if (rfc && validarRfc(rfc) !== null) errores.push({ campo: "rfc", mensaje: "Ese RFC no tiene la forma de un RFC. Déjalo vacío si no lo tienes." });
  const { correos, error } = leerCorreos(entrada.correos);
  if (error) errores.push({ campo: "correos", mensaje: error });
  return nombre && !error && !(rfc && validarRfc(rfc) !== null) ? { nombre, rfc, correos } : null;
}

export function validarClienteEditado(entrada: Record<string, unknown>): Resultado<ClienteEscrito> {
  const errores: ErrorFlujo[] = [];
  const cliente = validarCliente(entrada, errores);
  if (!cliente || errores.length > 0) return { ok: false, errores };
  return { ok: true, valor: cliente };
}

export type PlanEscrito = {
  concepto: string;
  tipo: "fijo" | "variable";
  montoCentavos: number | null;
  periodicidad: Periodicidad;
  primerVencimiento: string;
  fin: string | null;
};

export type AltaEscrita = { cliente: ClienteEscrito; plan: PlanEscrito };

/** Alta de un cliente con su plan, en un solo paso. */
export function validarAlta(entrada: Record<string, unknown>, hoy: string): Resultado<AltaEscrita> {
  const errores: ErrorFlujo[] = [];
  const cliente = validarCliente(entrada, errores);
  const plan = validarPlan(entrada, hoy, errores);
  if (errores.length > 0 || !cliente || !plan) return { ok: false, errores };
  return { ok: true, valor: { cliente, plan } };
}

/** Un plan nuevo para un cliente que ya existe (por ejemplo, para cambiar la periodicidad). */
export function validarPlanNuevo(entrada: Record<string, unknown>, hoy: string): Resultado<PlanEscrito> {
  const errores: ErrorFlujo[] = [];
  const plan = validarPlan(entrada, hoy, errores);
  if (errores.length > 0 || !plan) return { ok: false, errores };
  return { ok: true, valor: plan };
}

function validarPlan(entrada: Record<string, unknown>, hoy: string, errores: ErrorFlujo[]): PlanEscrito | null {
  const concepto = conceptoLimpio(entrada.concepto);
  if (!concepto) errores.push({ campo: "concepto", mensaje: "Escribe el concepto del cobro, por ejemplo «Renta de bodega»." });
  const tipo = entrada.tipo === "fijo" || entrada.tipo === "variable" ? entrada.tipo : null;
  if (!tipo) errores.push({ campo: "tipo", mensaje: "Elige si el monto es fijo o cambia cada periodo." });
  let montoCentavos: number | null = null;
  if (tipo === "fijo") {
    montoCentavos = monto(entrada.monto);
    if (montoCentavos === null) errores.push({ campo: "monto", mensaje: "Escribe el monto de cada periodo en pesos, mayor a cero." });
  } else if (tipo === "variable" && texto(entrada.monto) !== "") {
    errores.push({ campo: "monto", mensaje: "En un plan variable el monto se escribe cada periodo. Deja este campo vacío." });
  }
  const periodicidad = esPeriodicidad(entrada.periodicidad) ? entrada.periodicidad : null;
  if (!periodicidad) errores.push({ campo: "periodicidad", mensaje: "Elige cada cuánto se cobra." });
  const primerVencimiento = fechaValida(entrada.primerVencimiento);
  if (!primerVencimiento) errores.push({ campo: "primerVencimiento", mensaje: "Elige la fecha del primer vencimiento." });
  else if (primerVencimiento < hoy) errores.push({ campo: "primerVencimiento", mensaje: "El primer vencimiento no puede ser de un día que ya pasó." });
  else if (primerVencimiento > desplazar(hoy, HORIZONTE_DIAS)) errores.push({ campo: "primerVencimiento", mensaje: "El primer vencimiento tiene que caer en los próximos dos años." });
  const finEscrito = texto(entrada.fin);
  const fin = finEscrito === "" ? null : fechaValida(finEscrito);
  if (finEscrito !== "" && !fin) errores.push({ campo: "fin", mensaje: "Elige una fecha de fin válida o déjala vacía." });
  else if (fin && primerVencimiento && fin < primerVencimiento) errores.push({ campo: "fin", mensaje: "El fin no puede ser antes del primer vencimiento." });
  if (!concepto || !tipo || !periodicidad || !primerVencimiento || (finEscrito !== "" && !fin)) return null;
  return { concepto, tipo, montoCentavos, periodicidad, primerVencimiento, fin };
}

export type PlanEditado = { concepto: string; montoCentavos: number | null; fin: string | null };

export function validarPlanEditado(entrada: Record<string, unknown>, plan: { tipo: "fijo" | "variable"; primerVencimiento: string }): Resultado<PlanEditado> {
  const errores: ErrorFlujo[] = [];
  const concepto = conceptoLimpio(entrada.concepto);
  if (!concepto) errores.push({ campo: "concepto", mensaje: "Escribe el concepto del cobro." });
  let montoCentavos: number | null = null;
  if (plan.tipo === "fijo") {
    montoCentavos = monto(entrada.monto);
    if (montoCentavos === null) errores.push({ campo: "monto", mensaje: "Escribe el monto de cada periodo en pesos, mayor a cero." });
  }
  const finEscrito = texto(entrada.fin);
  const fin = finEscrito === "" ? null : fechaValida(finEscrito);
  if (finEscrito !== "" && !fin) errores.push({ campo: "fin", mensaje: "Elige una fecha de fin válida o déjala vacía." });
  else if (fin && fin < plan.primerVencimiento) errores.push({ campo: "fin", mensaje: "El fin no puede ser antes del primer vencimiento." });
  if (errores.length > 0 || !concepto) return { ok: false, errores };
  return { ok: true, valor: { concepto, montoCentavos, fin } };
}

export type ConfiguracionEscrita = {
  clabe: string;
  beneficiario: string;
  correoContacto: string | null;
  emitirDiasAntes: number;
  antesDias: number;
  avisoElDia: boolean;
  despuesCadaDias: number;
  despuesTope: number;
  envioAutomatico: boolean;
};

function entero(valor: unknown, min: number, max: number): number | null {
  const t = texto(valor);
  if (!/^[0-9]{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

export function validarConfiguracion(entrada: Record<string, unknown>): Resultado<ConfiguracionEscrita> {
  const errores: ErrorFlujo[] = [];
  const clabe = clabeValida(entrada.clabe);
  if (!clabe.ok) errores.push({ campo: "clabe", mensaje: "Esa CLABE no cierra: son 18 dígitos y el último verifica los otros 17." });
  const beneficiario = textoLimpio(entrada.beneficiario, 120, 2);
  if (!beneficiario) errores.push({ campo: "beneficiario", mensaje: "Escribe el titular de la cuenta tal como lo tiene el banco." });
  const contactoEscrito = texto(entrada.correoContacto).toLowerCase();
  const correoContacto = contactoEscrito === "" ? null : contactoEscrito;
  if (correoContacto && !correoValido(correoContacto)) errores.push({ campo: "correoContacto", mensaje: "Escribe un correo válido para que tus clientes te respondan, o déjalo vacío." });
  const emitirDiasAntes = entero(entrada.emitirDiasAntes, 0, 30);
  if (emitirDiasAntes === null) errores.push({ campo: "emitirDiasAntes", mensaje: "Elige entre 0 y 30 días." });
  const antesDias = entero(entrada.antesDias, 0, 15);
  if (antesDias === null) errores.push({ campo: "antesDias", mensaje: "Elige entre 0 y 15 días; 0 lo apaga." });
  else if (emitirDiasAntes !== null && antesDias > 0 && antesDias >= emitirDiasAntes) {
    errores.push({ campo: "antesDias", mensaje: "El recordatorio previo va después del cobro: usa menos días que los del envío del cobro." });
  }
  const despuesCadaDias = entero(entrada.despuesCadaDias, 1, 30);
  if (despuesCadaDias === null) errores.push({ campo: "despuesCadaDias", mensaje: "Elige entre 1 y 30 días." });
  const despuesTope = entero(entrada.despuesTope, 0, 6);
  if (despuesTope === null) errores.push({ campo: "despuesTope", mensaje: "Elige entre 0 y 6 recordatorios; 0 los apaga." });
  if (errores.length > 0 || !clabe.ok || !beneficiario || emitirDiasAntes === null || antesDias === null || despuesCadaDias === null || despuesTope === null) {
    return { ok: false, errores };
  }
  return {
    ok: true,
    valor: {
      clabe: clabe.clabe,
      beneficiario,
      correoContacto,
      emitirDiasAntes,
      antesDias,
      avisoElDia: entrada.avisoElDia === "si",
      despuesCadaDias,
      despuesTope,
      envioAutomatico: entrada.envioAutomatico === "si",
    },
  };
}

export type PagoEscrito = { montoCentavos: number; recibidoEl: string; claveRastreo: string | null };

export function validarPagoManual(entrada: Record<string, unknown>, hoy: string): Resultado<PagoEscrito> {
  const errores: ErrorFlujo[] = [];
  const montoCentavos = monto(entrada.monto);
  if (montoCentavos === null) errores.push({ campo: "monto", mensaje: "Escribe el monto que llegó, en pesos." });
  const recibidoEl = fechaValida(entrada.recibidoEl);
  if (!recibidoEl) errores.push({ campo: "recibidoEl", mensaje: "Elige el día en que llegó el dinero." });
  else if (recibidoEl > hoy) errores.push({ campo: "recibidoEl", mensaje: "El pago no puede ser de un día que todavía no llega." });
  const rastreoEscrito = texto(entrada.claveRastreo).toUpperCase();
  const claveRastreo = rastreoEscrito === "" ? null : rastreoEscrito;
  if (claveRastreo && !/^[A-Z0-9]{1,30}$/.test(claveRastreo)) errores.push({ campo: "claveRastreo", mensaje: "La clave de rastreo son hasta 30 letras y números, sin espacios." });
  if (errores.length > 0 || montoCentavos === null || !recibidoEl) return { ok: false, errores };
  return { ok: true, valor: { montoCentavos, recibidoEl, claveRastreo } };
}

export function validarMontoVariable(valor: unknown): Resultado<number> {
  const centavos = monto(valor);
  if (centavos === null) return { ok: false, errores: [{ campo: "monto", mensaje: "Escribe el monto de este periodo en pesos, mayor a cero." }] };
  return { ok: true, valor: centavos };
}

export type CargoUnicoEscrito = { concepto: string; montoCentavos: number; vencimiento: string };

export function validarCargoUnico(entrada: Record<string, unknown>, hoy: string): Resultado<CargoUnicoEscrito> {
  const errores: ErrorFlujo[] = [];
  const concepto = conceptoLimpio(entrada.concepto);
  if (!concepto) errores.push({ campo: "concepto", mensaje: "Escribe el concepto del cargo." });
  const montoCentavos = monto(entrada.monto);
  if (montoCentavos === null) errores.push({ campo: "monto", mensaje: "Escribe el monto en pesos, mayor a cero." });
  const vencimiento = fechaValida(entrada.vencimiento);
  if (!vencimiento) errores.push({ campo: "vencimiento", mensaje: "Elige la fecha de vencimiento." });
  else if (vencimiento < hoy) errores.push({ campo: "vencimiento", mensaje: "El vencimiento no puede ser de un día que ya pasó." });
  if (errores.length > 0 || !concepto || montoCentavos === null || !vencimiento) return { ok: false, errores };
  return { ok: true, valor: { concepto, montoCentavos, vencimiento } };
}

/** Comprobante de un pago manual: PDF (el CEP de Banxico), PNG o JPG, hasta 4 MB. Se reconoce por sus primeros bytes. */
export const TOPE_COMPROBANTE = 4 * 1024 * 1024;

export function validarComprobante(nombre: unknown, bytes: Uint8Array): { ok: true; nombre: string; tipo: "application/pdf" | "image/png" | "image/jpeg" } | { ok: false; mensaje: string } {
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength < 64) return { ok: false, mensaje: "El comprobante está vacío o incompleto." };
  if (bytes.byteLength > TOPE_COMPROBANTE) return { ok: false, mensaje: "El comprobante pesa más de 4 MB." };
  const limpio = (typeof nombre === "string" ? nombre : "").replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  if (!limpio || limpio.length > 180 || /[\u0000-\u001f\u007f]/.test(limpio)) return { ok: false, mensaje: "El nombre del archivo no es válido." };
  const empieza = (firma: readonly number[]) => firma.every((b, i) => bytes[i] === b);
  if (empieza([0x25, 0x50, 0x44, 0x46, 0x2d])) return { ok: true, nombre: limpio, tipo: "application/pdf" };
  if (empieza([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, nombre: limpio, tipo: "image/png" };
  if (empieza([0xff, 0xd8, 0xff])) return { ok: true, nombre: limpio, tipo: "image/jpeg" };
  return { ok: false, mensaje: "Sube el comprobante en PDF, PNG o JPG." };
}
