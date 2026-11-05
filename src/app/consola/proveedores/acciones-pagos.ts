"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { enEmpresa } from "@/nucleo/rutas";

import type { CfdiLeido } from "@/dominio/cfdi";
import {
  agregarContratoProveedor,
  cancelarPagoProveedor,
  crearPagoProveedor,
  editarYReenviarPago,
  inspeccionarCfdi,
  resolverPagoProveedor,
  type ArchivoPago,
} from "@/server/pagos-proveedores";
import { contextoDeAccion, errorConSecreto, sesionSegura } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";

import type { EstadoPagoFormulario } from "./estado";
export type { EstadoPagoFormulario } from "./estado";

const MENSAJES: Record<string, string> = {
  sesion_ausente: "Vuelve a entrar para continuar.",
  sin_empresa: "Selecciona una empresa antes de continuar.",
  sin_permiso: "Tu rol no tiene esta acción.",
  proveedor_ausente: "Selecciona un proveedor válido.",
  pago_no_autorizable: "Revisa el proveedor, la lista 69-B, la CLABE vigente y las dos personas autorizadas para liberar.",
  monto_invalido: "Escribe un importe mayor que cero y con centavos válidos.",
  fecha_invalida: "Revisa las fechas. El vencimiento no puede ser anterior a la emisión.",
  fecha_pasada: "La fecha prevista de pago no puede estar en el pasado.",
  referencia_invalida: "Escribe una referencia de entre 1 y 120 caracteres.",
  motivo_invalido: "Explica el motivo con al menos 10 caracteres. Al rechazar o cancelar bastan 5.",
  archivo_ausente: "Carga todos los archivos requeridos antes de continuar.",
  archivo_no_disponible: "El archivo no es válido o no está disponible. Usa PDF legible de hasta 8 MB.",
  archivos_peso_total: "El XML y el PDF juntos no pueden superar 8 MB.",
  cfdi_invalido: "El XML no es legible o contiene una estructura no permitida.",
  cfdi_codificacion: "El XML debe venir codificado en UTF-8.",
  cfdi_no_es_ingreso_mxn: "El CFDI debe ser versión 4.0, tipo ingreso y moneda MXN.",
  cfdi_datos_incompletos: "Al CFDI le faltan timbre, partes, fecha o importe válido.",
  cfdi_emisor_distinto: "El RFC emisor del CFDI no coincide con el proveedor seleccionado.",
  cfdi_receptor_distinto: "El CFDI no está emitido a la empresa con la que entraste.",
  cfdi_duplicado: "Ese UUID ya está registrado en esta empresa.",
  reautenticacion_requerida: "La autorización exige un segundo factor reciente. Sal y vuelve a entrar para renovarlo.",
  cancelacion_no_permitida: "Solo quien solicitó el pago puede cancelarlo mientras sigue pendiente.",
  idempotencia_invalida: "La referencia de esta solicitud no es válida. Recarga el formulario para generar una nueva.",
  base_no_disponible: "No se pudo completar la operación. Inténtalo de nuevo.",
  auditoria_no_disponible: "No se pudo dejar constancia. La operación no se guardó.",
};

export type EstadoLecturaCfdi = { tipo: "inicial" } | { tipo: "listo"; cfdi: CfdiLeido } | { tipo: "invalido"; mensaje: string };

export async function prellenarCfdi(
  _previo: EstadoLecturaCfdi,
  formData: FormData,
): Promise<EstadoLecturaCfdi> {
  try {
    const archivo = await leerArchivo(formData.get("xml"));
    const cfdi = inspeccionarCfdi(await contextoDeAccion(), archivo);
    return { tipo: "listo", cfdi };
  } catch (error) {
    return { tipo: "invalido", mensaje: traducir(error) };
  }
}

export async function enviarPago(
  _previo: EstadoPagoFormulario,
  formData: FormData,
): Promise<EstadoPagoFormulario> {
  try {
    const [xml, pdf] = await Promise.all([leerArchivo(formData.get("xml")), leerArchivo(formData.get("pdf"))]);
    if ((xml?.bytes.byteLength ?? 0) + (pdf?.bytes.byteLength ?? 0) > 8_000_000) throw new ErrorDeDominio("archivos_peso_total");
    const creado = await crearPagoProveedor(await contextoDeAccion(), entrada(formData, xml, pdf));
    revalidatePath("/consola/proveedores");
    return { tipo: "listo", mensaje: creado.existente ? "La solicitud ya existía. No se duplicó el pago." : "El pago quedó enviado a autorización. Todavía no se mueve dinero.", requestId: creado.requestId };
  } catch (error) {
    return { tipo: "invalido", mensaje: traducir(error) };
  }
}

export async function reenviarPago(
  _previo: EstadoPagoFormulario,
  formData: FormData,
): Promise<EstadoPagoFormulario> {
  try {
    const requestId = texto(formData, "requestId");
    const ctx = await contextoDeAccion();
    await editarYReenviarPago(ctx, requestId, entrada(formData, null, null));
    revalidatePath("/consola/proveedores");
    if (!ctx?.empresa) throw new ErrorDeDominio("sin_empresa");
    redirect(enEmpresa(ctx.empresa.id, `/consola/proveedores?pago=${requestId}`));
  } catch (error) {
    return { tipo: "invalido", mensaje: traducir(error) };
  }
}

export async function decidirPago(
  _previo: EstadoPagoFormulario,
  formData: FormData,
): Promise<EstadoPagoFormulario> {
  try {
    const decision = texto(formData, "decision");
    if (decision !== "autorizar" && decision !== "rechazar") throw new ErrorDeDominio("pago_no_autorizable");
    const sesion = await sesionSegura();
    if (!sesion) throw new ErrorDeDominio("reautenticacion_requerida");
    await resolverPagoProveedor(await contextoDeAccion(), sesion, {
      requestId: texto(formData, "requestId"), decision, motivo: texto(formData, "motivo"),
    });
    revalidatePath("/consola/proveedores");
    return {
      tipo: "listo",
      mensaje: decision === "autorizar" ? "Quedó listo para pagar. No se envió dinero." : "Quedó rechazado con su motivo. La factura sigue disponible para corrección.",
      requestId: texto(formData, "requestId"),
    };
  } catch (error) {
    return { tipo: "invalido", mensaje: traducir(error) };
  }
}

export async function cancelarPago(
  _previo: EstadoPagoFormulario,
  formData: FormData,
): Promise<EstadoPagoFormulario> {
  try {
    await cancelarPagoProveedor(await contextoDeAccion(), {
      requestId: texto(formData, "requestId"), motivo: texto(formData, "motivoCancelacion"),
    });
    revalidatePath("/consola/proveedores");
    return { tipo: "listo", mensaje: "La solicitud quedó cancelada. Su historial se conserva." };
  } catch (error) {
    return { tipo: "invalido", mensaje: traducir(error) };
  }
}

export async function subirContrato(
  _previo: EstadoPagoFormulario,
  formData: FormData,
): Promise<EstadoPagoFormulario> {
  try {
    await agregarContratoProveedor(await contextoDeAccion(), {
      supplierId: texto(formData, "supplierId"), pdf: await leerArchivo(formData.get("contrato")),
      vigenteDesde: texto(formData, "vigenteDesde") || null, vigenteHasta: texto(formData, "vigenteHasta") || null,
    });
    revalidatePath("/consola/proveedores");
    return { tipo: "listo", mensaje: "El contrato quedó guardado como documento privado." };
  } catch (error) {
    return { tipo: "invalido", mensaje: traducir(error) };
  }
}

function entrada(formData: FormData, xml: ArchivoPago, pdf: ArchivoPago) {
  return {
    supplierId: texto(formData, "supplierId"), origen: texto(formData, "origen"),
    clientRequestId: texto(formData, "clientRequestId"), xml, pdf,
    monto: texto(formData, "monto"), referencia: texto(formData, "referencia"),
    emitidaEl: texto(formData, "emitidaEl"), venceEl: texto(formData, "venceEl"),
    programadaEl: texto(formData, "programadaEl"), motivoExcepcion: texto(formData, "motivoExcepcion"),
  };
}

async function leerArchivo(valor: unknown): Promise<ArchivoPago> {
  if (typeof valor !== "object" || valor === null || !("arrayBuffer" in valor) || !("size" in valor)) return null;
  const archivo = valor as { name?: unknown; size?: unknown; arrayBuffer?: () => Promise<ArrayBuffer> };
  const peso = typeof archivo.size === "number" ? archivo.size : 0;
  const nombre = typeof archivo.name === "string" ? archivo.name : "";
  if (peso === 0 && !nombre.trim()) return null;
  if (peso > 8_000_000 || typeof archivo.arrayBuffer !== "function") return { nombre, bytes: new Uint8Array() };
  return { nombre, bytes: new Uint8Array(await archivo.arrayBuffer()) };
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : "";
}

function traducir(error: unknown): string {
  if (error instanceof ErrorDeDominio) return MENSAJES[error.codigo] ?? "No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.";
  if (errorConSecreto(error)) return MENSAJES.base_no_disponible ?? "No se pudo completar la operación.";
  throw error;
}
