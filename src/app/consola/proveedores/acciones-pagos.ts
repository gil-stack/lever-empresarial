"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { enEmpresa } from "@/nucleo/rutas";
import { TOPE_ARCHIVO_BYTES, TOPE_ARCHIVO_TEXTO } from "@/dominio/archivos";
import { XML_Y_PDF } from "@/dominio/proveedores";

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

import { leerArchivoPago } from "./archivos";
import type { EstadoPagoFormulario } from "./estado";
export type { EstadoPagoFormulario } from "./estado";

const MENSAJES: Record<string, string> = {
  sesion_ausente: "Vuelve a entrar para continuar.",
  sin_empresa: "Selecciona una empresa antes de continuar.",
  sin_permiso: "Tu rol no tiene esta acción.",
  proveedor_ausente: "Selecciona un proveedor válido.",
  pago_no_autorizable: "Revisa el proveedor, la lista 69-B, la CLABE vigente y las dos personas autorizadas para liberar.",
  monto_invalido: "Escribe un importe mayor que cero y con centavos válidos.",
  fecha_invalida: "Revisa las fechas: deben existir en el calendario y el vencimiento no puede ser anterior a la emisión.",
  fecha_emision_invalida: "Esa fecha de la obligación no existe en el calendario.",
  fecha_programada_invalida: "Esa fecha prevista de pago no existe en el calendario.",
  fecha_desde_invalida: "Esa fecha de «Vigente desde» no existe en el calendario.",
  fecha_hasta_invalida: "Revisa «Vigente hasta»: debe existir en el calendario y no puede ser anterior a «Vigente desde».",
  fecha_pasada: "La fecha prevista de pago no puede estar en el pasado.",
  referencia_invalida: "Escribe una referencia de entre 1 y 120 caracteres.",
  motivo_invalido: "Explica el motivo con al menos 10 caracteres. Al rechazar o cancelar bastan 5.",
  archivo_ausente: "Carga todos los archivos requeridos antes de continuar.",
  archivo_no_disponible: `El archivo no es válido o no está disponible. Usa PDF legible de hasta ${TOPE_ARCHIVO_TEXTO}.`,
  archivos_peso_total: XML_Y_PDF,
  cfdi_invalido: "El XML no es legible o contiene una estructura no permitida.",
  cfdi_codificacion: "El XML debe venir codificado en UTF-8.",
  cfdi_contenido_no_permitido: "El XML trae HTML, SVG, scripts u hojas de estilo, que un CFDI no lleva. Sube el XML original que timbró el SAT.",
  cfdi_no_es_ingreso_mxn: "El CFDI debe ser versión 4.0, tipo ingreso y moneda MXN.",
  cfdi_datos_incompletos: "Al CFDI le faltan timbre, partes, fecha o importe válido.",
  cfdi_emisor_distinto: "El RFC emisor del CFDI no coincide con el proveedor seleccionado.",
  cfdi_receptor_distinto: "El CFDI no está emitido a la empresa con la que entraste.",
  cfdi_duplicado: "Ese UUID ya está registrado en esta empresa.",
  reautenticacion_requerida: "La autorización exige un segundo factor reciente. Sal y vuelve a entrar para renovarlo.",
  cancelacion_no_permitida: "Quien solicitó cancela mientras espera autorización o tras un rechazo; un pago listo para pagar lo cancela un liberador o administrador.",
  pago_cambio_en_revision: "La solicitud cambió mientras la revisabas (otra decisión, una corrección o un regreso a revisión). Recarga y revisa la versión vigente antes de decidir.",
  evidencia_requerida: "Si cambias el importe de una excepción, adjunta evidencia nueva en PDF que lo respalde.",
  cfdi_inmutable: "Los datos fiscales de un CFDI no se corrigen. Si la factura está mal, cancela esta solicitud y captura el CFDI correcto.",
  sin_permiso_para_liberar: "Solo un liberador vigente, distinto de quien solicitó, puede decidir este pago.",
  sin_permiso_para_solicitar: "Tu rol o tu alta vigente no permiten solicitar este pago.",
  idempotencia_invalida: "La referencia de esta solicitud no es válida. Recarga el formulario para generar una nueva.",
  base_no_disponible: "No se pudo completar la operación. Inténtalo de nuevo.",
  // Ola R1: la base rechaza el pago de una empresa suspendida o con un proveedor en la Lista de Personas Bloqueadas.
  empresa_suspendida: "La empresa está suspendida: no se puede mover dinero ni hacer cambios. Comunícate con Lever.",
  pago_bloqueado_lpb: "Este pago quedó detenido para revisión de cumplimiento. No se liberó; Lever te contactará.",
  auditoria_no_disponible: "No se pudo dejar constancia. La operación no se guardó.",
};

/** El campo que corrige cada error en la solicitud de pago; los formularios lo ligan con aria-describedby. */
const CAMPO_DEL_ERROR: Record<string, string> = {
  proveedor_ausente: "supplierId",
  cfdi_emisor_distinto: "supplierId",
  monto_invalido: "monto",
  referencia_invalida: "referencia",
  fecha_invalida: "venceEl",
  fecha_emision_invalida: "emitidaEl",
  fecha_programada_invalida: "programadaEl",
  fecha_desde_invalida: "vigenteDesde",
  fecha_hasta_invalida: "vigenteHasta",
  fecha_pasada: "programadaEl",
  motivo_invalido: "motivoExcepcion",
  archivo_no_disponible: "pdf",
  archivos_peso_total: "pdf",
  evidencia_requerida: "pdf",
  cfdi_invalido: "xml",
  cfdi_codificacion: "xml",
  cfdi_contenido_no_permitido: "xml",
  cfdi_no_es_ingreso_mxn: "xml",
  cfdi_datos_incompletos: "xml",
  cfdi_receptor_distinto: "xml",
  cfdi_duplicado: "xml",
};

export type EstadoLecturaCfdi = { tipo: "inicial" } | { tipo: "listo"; cfdi: CfdiLeido } | { tipo: "invalido"; mensaje: string };

export async function prellenarCfdi(
  _previo: EstadoLecturaCfdi,
  formData: FormData,
): Promise<EstadoLecturaCfdi> {
  try {
    const archivo = await leerArchivoPago(formData.get("xml"));
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
    const [xml, pdf] = await Promise.all([leerArchivoPago(formData.get("xml")), leerArchivoPago(formData.get("pdf"))]);
    if ((xml?.bytes.byteLength ?? 0) + (pdf?.bytes.byteLength ?? 0) > TOPE_ARCHIVO_BYTES) throw new ErrorDeDominio("archivos_peso_total");
    const creado = await crearPagoProveedor(await contextoDeAccion(), entrada(formData, xml, pdf));
    revalidatePath("/consola/proveedores");
    return { tipo: "listo", mensaje: creado.existente ? "La solicitud ya existía. No se duplicó el pago." : "El pago quedó en autorización. Otra persona lo revisa.", requestId: creado.requestId };
  } catch (error) {
    return invalido(error);
  }
}

export async function reenviarPago(
  _previo: EstadoPagoFormulario,
  formData: FormData,
): Promise<EstadoPagoFormulario> {
  try {
    const requestId = texto(formData, "requestId");
    const pdf = await leerArchivoPago(formData.get("pdf"));
    const ctx = await contextoDeAccion();
    await editarYReenviarPago(ctx, requestId, entrada(formData, null, pdf));
    revalidatePath("/consola/proveedores");
    if (!ctx?.empresa) throw new ErrorDeDominio("sin_empresa");
    redirect(enEmpresa(ctx.empresa.id, `/consola/proveedores?pago=${requestId}`));
  } catch (error) {
    return invalido(error);
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
      version: texto(formData, "version"), totalCentavos: texto(formData, "totalCentavos"),
    });
    revalidatePath("/consola/proveedores");
    return {
      tipo: "listo",
      mensaje: decision === "autorizar" ? "Quedó listo para pagar." : "Quedó rechazado con su motivo. La factura sigue disponible para corrección.",
      requestId: texto(formData, "requestId"),
    };
  } catch (error) {
    return invalido(error, { motivo_invalido: "motivo" });
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
    return { tipo: "listo", mensaje: "La solicitud quedó cancelada y su CFDI quedó libre para capturarse de nuevo. Su historial se conserva." };
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
      supplierId: texto(formData, "supplierId"), pdf: await leerArchivoPago(formData.get("contrato")),
      vigenteDesde: texto(formData, "vigenteDesde") || null, vigenteHasta: texto(formData, "vigenteHasta") || null,
    });
    revalidatePath("/consola/proveedores");
    return { tipo: "listo", mensaje: "El contrato quedó guardado como documento privado." };
  } catch (error) {
    return invalido(error, { archivo_ausente: "contrato", archivo_no_disponible: "contrato" });
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

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : "";
}

/** El error traducido y, cuando nace de un campo, ese campo (los de esta acción mandan sobre los generales). */
function invalido(error: unknown, propios: Record<string, string> = {}): EstadoPagoFormulario {
  const mensaje = traducir(error);
  const codigo = error instanceof ErrorDeDominio ? error.codigo : null;
  const campo = codigo ? (propios[codigo] ?? CAMPO_DEL_ERROR[codigo]) : undefined;
  return campo ? { tipo: "invalido", mensaje, campo } : { tipo: "invalido", mensaje };
}

function traducir(error: unknown): string {
  if (error instanceof ErrorDeDominio) return MENSAJES[error.codigo] ?? "No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.";
  if (errorConSecreto(error)) return MENSAJES.base_no_disponible ?? "No se pudo completar la operación.";
  throw error;
}
