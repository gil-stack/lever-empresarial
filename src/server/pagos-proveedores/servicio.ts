import { createHash, randomUUID } from "node:crypto";

import { leerCfdi, validarPdfPrivado, type CfdiLeido } from "../../dominio/cfdi";
import {
  fechaEnMexico,
  montoEscrito,
  textoPago,
  uuidPago,
  validarFechasPago,
  type OrigenPago,
} from "../../dominio/pagos-proveedores";
import { exigir, type ContextoConEmpresa, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirAutenticacionRecienteCliente } from "../autenticacion/reautenticacion";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { almacenVercel, leerPrivado, type AlmacenConstancia } from "../proveedores/constancia";
import type { Sesion } from "../session/tipos";
import { repositorioPg } from "./repositorio";
import type { ProveedorPago } from "../../dominio/pagos-vistas";
import type { CargoNuevo, ContextoPagos, FiltrosPagos, RepositorioPagos } from "./tipos";

export type ArchivoPago = { nombre: string; bytes: Uint8Array } | null;
export type EntradaPago = {
  supplierId: unknown;
  origen: unknown;
  clientRequestId?: unknown;
  xml?: ArchivoPago;
  pdf?: ArchivoPago;
  monto?: unknown;
  referencia?: unknown;
  emitidaEl?: unknown;
  venceEl?: unknown;
  programadaEl?: unknown;
  motivoExcepcion?: unknown;
};

export type DependenciasPagos = {
  repositorio?: RepositorioPagos;
  almacen?: AlmacenConstancia;
  auditar?: Auditar;
  ahora?: () => Date;
  id?: () => string;
};

export async function leerPagosProveedores(ctx: ContextoDeTenant | null | undefined, filtros: FiltrosPagos = {}, deps?: DependenciasPagos) {
  const conEmpresa = exigir(ctx, "cliente.proveedores.ver");
  return resolver(deps).repositorio.leer(conEmpresa, filtros);
}

export function inspeccionarCfdi(ctx: ContextoDeTenant | null | undefined, archivo: ArchivoPago): CfdiLeido {
  exigir(ctx, "cliente.pago.solicitar");
  if (!archivo) throw new ErrorDeDominio("archivo_ausente");
  const leido = leerCfdi(archivo.bytes);
  if (!leido.ok) throw new ErrorDeDominio(leido.codigo);
  return leido.cfdi;
}

export async function crearPagoProveedor(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaPago,
  deps?: DependenciasPagos,
): Promise<{ requestId: string; payableId: string; existente: boolean }> {
  const conEmpresa = exigir(ctx, "cliente.pago.solicitar");
  if (!uuidPago(entrada.clientRequestId)) throw new ErrorDeDominio("idempotencia_invalida");
  const clientRequestId = entrada.clientRequestId;
  const listo = resolver(deps);
  const ahora = listo.ahora();
  const hoy = fechaEnMexico(ahora);
  const preparado = prepararPago(entrada, hoy);
  const claves: string[] = [];
  try {
    return await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
      const existente = await tx.solicitudPorClave(clientRequestId);
      if (existente) return { ...existente, existente: true };
      const proveedor = await exigirProveedor(tx, preparado.supplierId, conEmpresa, preparado.cfdi);
      const payableId = listo.id();
      const requestId = listo.id();
      const cargo: CargoNuevo = {
        id: payableId,
        supplierId: proveedor.id,
        origen: preparado.origen,
        cfdiUuid: preparado.cfdi?.uuid ?? null,
        serie: preparado.cfdi?.serie ?? null,
        folio: preparado.cfdi?.folio ?? null,
        referencia: preparado.cfdi?.referencia ?? preparado.referencia ?? "",
        totalCentavos: preparado.cfdi?.totalCentavos ?? preparado.totalCentavos ?? 0,
        emitidaEl: preparado.cfdi?.emitidaEl ?? preparado.emitidaEl,
        venceEl: preparado.venceEl,
        programadaEl: preparado.programadaEl,
        motivoExcepcion: preparado.motivoExcepcion ?? null,
        creadoPor: conEmpresa.persona.id,
        creadoEn: ahora,
      };
      await tx.insertarCargo(cargo);
      await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
        accion: "crear_cargo_proveedor", identificador: payableId,
        cambio: { origen: cargo.origen, total_centavos: cargo.totalCentavos },
      });
      const documentos = preparado.origen === "cfdi"
        ? [{ archivo: entrada.xml, tipo: "xml" as const }, { archivo: entrada.pdf, tipo: "pdf" as const }]
        : [{ archivo: entrada.pdf, tipo: "evidencia" as const }];
      for (const documento of documentos) {
        if (!documento.archivo) throw new ErrorDeDominio("archivo_ausente");
        await guardarDocumentoCargo(tx, listo, conEmpresa, {
          payableId, documentoId: listo.id(), archivo: documento.archivo, tipo: documento.tipo, ahora, claves,
        });
      }
      await tx.insertarSolicitud({
        id: requestId, payableId, clientRequestId, supplierClabeId: proveedor.clabeId, clabe: proveedor.clabe,
        totalCentavos: cargo.totalCentavos, programadaEl: cargo.programadaEl,
        solicitadoPor: conEmpresa.persona.id, solicitadoEn: ahora,
      });
      await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
        accion: "solicitar_pago_proveedor", identificador: requestId,
        cambio: { total_centavos: cargo.totalCentavos },
      });
      return { requestId, payableId, existente: false };
    });
  } catch (error) {
    await limpiarArchivos(listo.almacen, claves);
    if (error instanceof ErrorDeDominio && error.codigo === "idempotencia_pago_duplicada") {
      return listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
        const existente = await tx.solicitudPorClave(clientRequestId);
        if (!existente) throw error;
        return { ...existente, existente: true };
      });
    }
    throw error;
  }
}

export async function editarYReenviarPago(
  ctx: ContextoDeTenant | null | undefined,
  requestId: unknown,
  entrada: EntradaPago,
  deps?: DependenciasPagos,
): Promise<void> {
  const conEmpresa = exigir(ctx, "cliente.pago.solicitar");
  if (!uuidPago(requestId)) throw new ErrorDeDominio("pago_no_autorizable");
  const listo = resolver(deps);
  const ahora = listo.ahora();
  const hoy = fechaEnMexico(ahora);
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const solicitud = await tx.solicitud(requestId);
    if (!solicitud || solicitud.estado !== "rechazado" || solicitud.solicitadoPor !== conEmpresa.persona.id) {
      throw new ErrorDeDominio("pago_no_autorizable");
    }
    const cargo = await tx.cargo(solicitud.payableId);
    if (!cargo) throw new ErrorDeDominio("pago_no_autorizable");
    const preparado = prepararPago({ ...entrada, supplierId: cargo.supplierId, origen: cargo.origen }, hoy, cargo);
    const proveedor = await exigirProveedor(tx, cargo.supplierId, conEmpresa, null);
    const actualizado: CargoNuevo & { actualizadoEn: Date } = {
      ...cargo,
      referencia: cargo.origen === "cfdi" ? cargo.referencia : preparado.referencia ?? cargo.referencia,
      totalCentavos: cargo.origen === "cfdi" ? cargo.totalCentavos : preparado.totalCentavos ?? cargo.totalCentavos,
      emitidaEl: cargo.origen === "cfdi" ? cargo.emitidaEl : preparado.emitidaEl,
      venceEl: preparado.venceEl,
      programadaEl: preparado.programadaEl,
      motivoExcepcion: cargo.origen === "excepcion" ? (preparado.motivoExcepcion ?? null) : null,
      actualizadoEn: ahora,
    };
    await tx.actualizarCargo(actualizado);
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
      accion: "editar_cargo_proveedor", identificador: cargo.id, cambio: { total_centavos: actualizado.totalCentavos },
    });
    await tx.actualizarSolicitud({
      id: solicitud.id, estado: "por_autorizar", actor: conEmpresa.persona.id, ahora,
      motivo: null, version: solicitud.version + 1,
      instantanea: {
        supplierClabeId: proveedor.clabeId, clabe: proveedor.clabe, totalCentavos: actualizado.totalCentavos,
        programadaEl: actualizado.programadaEl, solicitadoEn: ahora,
      },
    });
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
      accion: "solicitar_pago_proveedor", identificador: solicitud.id, cambio: { total_centavos: actualizado.totalCentavos },
    });
  });
}

export async function resolverPagoProveedor(
  ctx: ContextoDeTenant | null | undefined,
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  entrada: { requestId: unknown; decision: "autorizar" | "rechazar"; motivo?: unknown },
  deps?: DependenciasPagos,
): Promise<void> {
  const conEmpresa = exigir(ctx, "cliente.pago.liberar");
  exigirAutenticacionRecienteCliente(sesion, deps?.ahora?.() ?? new Date());
  if (!uuidPago(entrada.requestId)) throw new ErrorDeDominio("pago_no_autorizable");
  const motivo = entrada.decision === "rechazar" ? textoPago(entrada.motivo, 500, 5) : null;
  if (entrada.decision === "rechazar" && !motivo) throw new ErrorDeDominio("motivo_invalido");
  const listo = resolver(deps);
  const ahora = listo.ahora();
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const solicitud = await tx.solicitud(entrada.requestId as string);
    if (!solicitud || solicitud.estado !== "por_autorizar" || solicitud.solicitadoPor === conEmpresa.persona.id) {
      throw new ErrorDeDominio("pago_no_autorizable");
    }
    const estado = entrada.decision === "autorizar" ? "listo_para_pagar" : "rechazado";
    await tx.actualizarSolicitud({ id: solicitud.id, estado, actor: conEmpresa.persona.id, ahora, motivo, version: solicitud.version });
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
      accion: estado === "listo_para_pagar" ? "autorizar_pago_proveedor" : "rechazar_pago_proveedor",
      identificador: solicitud.id, motivo,
    });
  });
}

export async function cancelarPagoProveedor(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { requestId: unknown; motivo?: unknown },
  deps?: DependenciasPagos,
): Promise<void> {
  const conEmpresa = exigir(ctx, "cliente.pago.solicitar");
  if (!uuidPago(entrada.requestId)) throw new ErrorDeDominio("pago_no_autorizable");
  const motivo = textoPago(entrada.motivo, 500, 5);
  if (!motivo) throw new ErrorDeDominio("motivo_invalido");
  const listo = resolver(deps);
  const ahora = listo.ahora();
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const solicitud = await tx.solicitud(entrada.requestId as string);
    if (!solicitud || solicitud.estado !== "por_autorizar" || solicitud.solicitadoPor !== conEmpresa.persona.id) {
      throw new ErrorDeDominio("cancelacion_no_permitida");
    }
    await tx.actualizarSolicitud({ id: solicitud.id, estado: "cancelado", actor: conEmpresa.persona.id, ahora, motivo, version: solicitud.version });
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), { accion: "cancelar_pago_proveedor", identificador: solicitud.id, motivo });
  });
}

export async function agregarContratoProveedor(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { supplierId: unknown; pdf: ArchivoPago; vigenteDesde?: unknown; vigenteHasta?: unknown },
  deps?: DependenciasPagos,
): Promise<void> {
  const conEmpresa = exigir(ctx, "cliente.proveedores.alta");
  if (!uuidPago(entrada.supplierId) || !entrada.pdf) throw new ErrorDeDominio("archivo_ausente");
  const pdf = validarPdfPrivado(entrada.pdf.nombre, entrada.pdf.bytes);
  if (!pdf.ok) throw new ErrorDeDominio("archivo_no_disponible");
  const desde = fechaOpcional(entrada.vigenteDesde);
  const hasta = fechaOpcional(entrada.vigenteHasta);
  if ((desde && hasta && hasta < desde) || entrada.vigenteDesde && !desde || entrada.vigenteHasta && !hasta) {
    throw new ErrorDeDominio("fecha_invalida");
  }
  const listo = resolver(deps);
  const ahora = listo.ahora();
  const claves: string[] = [];
  try {
    await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
      const proveedor = await tx.proveedor(entrada.supplierId as string);
      if (!proveedor) throw new ErrorDeDominio("proveedor_ausente");
      const documentoId = listo.id();
      await guardarDocumento(tx, listo, conEmpresa, {
        documentoId, archivo: entrada.pdf as { nombre: string; bytes: Uint8Array }, ahora, claves,
        carpeta: `proveedores/${proveedor.id}/contratos`, mime: "application/pdf",
      });
      await tx.vincularDocumentoProveedor(documentoId, proveedor.id, "contrato", desde, hasta, ahora);
      await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
        accion: "documento_proveedor", identificador: documentoId, cambio: { tipo: "contrato" },
      });
    });
  } catch (error) {
    await limpiarArchivos(listo.almacen, claves);
    throw error;
  }
}

export async function descargarDocumentoProveedor(
  ctx: ContextoDeTenant | null | undefined,
  documentoId: unknown,
  deps?: DependenciasPagos & { leer?: (clave: string) => Promise<ReadableStream<Uint8Array>> },
): Promise<{ bytes: Uint8Array; nombre: string; tipo: string }> {
  const conEmpresa = exigir(ctx, "cliente.proveedores.ver");
  if (!uuidPago(documentoId)) throw new ErrorDeDominio("archivo_no_disponible");
  const listo = resolver(deps);
  const documento = await listo.repositorio.documento(conEmpresa, documentoId);
  if (!documento) throw new ErrorDeDominio("archivo_no_disponible");
  const stream = await (deps?.leer ?? leerPrivado)(documento.clave);
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== documento.hash) throw new ErrorDeDominio("archivo_no_disponible");
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
      accion: "descargar_documento", identificador: documento.id, cambio: { tipo: documento.tipo },
    });
  });
  return { bytes, nombre: documento.nombre, tipo: documento.tipo };
}

function prepararPago(entrada: EntradaPago, hoy: string, actual?: CargoNuevo) {
  if (!uuidPago(entrada.supplierId)) throw new ErrorDeDominio("proveedor_ausente");
  if (entrada.origen !== "cfdi" && entrada.origen !== "excepcion") throw new ErrorDeDominio("pago_no_autorizable");
  const origen: OrigenPago = entrada.origen;
  let cfdi: CfdiLeido | null = null;
  if (origen === "cfdi" && !actual) {
    if (!entrada.xml || !entrada.pdf) throw new ErrorDeDominio("archivo_ausente");
    const leido = leerCfdi(entrada.xml.bytes);
    if (!leido.ok) throw new ErrorDeDominio(leido.codigo);
    cfdi = leido.cfdi;
    const pdf = validarPdfPrivado(entrada.pdf.nombre, entrada.pdf.bytes);
    if (!pdf.ok) throw new ErrorDeDominio("archivo_no_disponible");
  }
  if (origen === "excepcion" && !actual && !entrada.pdf) throw new ErrorDeDominio("archivo_ausente");
  if (origen === "excepcion" && !actual) {
    const pdf = validarPdfPrivado(entrada.pdf?.nombre, entrada.pdf?.bytes as Uint8Array);
    if (!pdf.ok) throw new ErrorDeDominio("archivo_no_disponible");
  }
  const emitidaEl = cfdi?.emitidaEl ?? fechaDeEntrada(entrada.emitidaEl, actual?.emitidaEl);
  const venceEl = fechaDeEntrada(entrada.venceEl, actual?.venceEl);
  const programadaEl = fechaDeEntrada(entrada.programadaEl, actual?.programadaEl);
  const fechaError = validarFechasPago({ emitidaEl, venceEl, programadaEl, hoy });
  if (fechaError) throw new ErrorDeDominio(fechaError);
  const totalCentavos = cfdi?.totalCentavos ?? montoEscrito(entrada.monto) ?? actual?.totalCentavos ?? null;
  if (!totalCentavos) throw new ErrorDeDominio("monto_invalido");
  const referencia = cfdi?.referencia ?? textoPago(entrada.referencia, 120) ?? actual?.referencia ?? null;
  if (!referencia) throw new ErrorDeDominio("referencia_invalida");
  const motivoExcepcion = origen === "excepcion" ? textoPago(entrada.motivoExcepcion, 500, 10) ?? actual?.motivoExcepcion : null;
  if (origen === "excepcion" && !motivoExcepcion) throw new ErrorDeDominio("motivo_invalido");
  return { supplierId: entrada.supplierId, origen, cfdi, totalCentavos, referencia, emitidaEl, venceEl, programadaEl, motivoExcepcion };
}

async function exigirProveedor(tx: ContextoPagos, supplierId: string, ctx: ContextoConEmpresa, cfdi: CfdiLeido | null): Promise<ProveedorPago> {
  const proveedor = await tx.proveedor(supplierId);
  if (!proveedor || !proveedor.activo || !proveedor.botonPago) throw new ErrorDeDominio("pago_no_autorizable");
  if (cfdi && cfdi.rfcEmisor !== proveedor.rfc) throw new ErrorDeDominio("cfdi_emisor_distinto");
  if (cfdi && cfdi.rfcReceptor !== ctx.empresa.rfc) throw new ErrorDeDominio("cfdi_receptor_distinto");
  return proveedor;
}

async function guardarDocumentoCargo(
  tx: ContextoPagos,
  listo: ReturnType<typeof resolver>,
  ctx: ContextoConEmpresa,
  entrada: { payableId: string; documentoId: string; archivo: { nombre: string; bytes: Uint8Array }; tipo: "xml" | "pdf" | "evidencia"; ahora: Date; claves: string[] },
): Promise<void> {
  await guardarDocumento(tx, listo, ctx, {
    documentoId: entrada.documentoId, archivo: entrada.archivo, ahora: entrada.ahora, claves: entrada.claves,
    carpeta: `pagos/${entrada.payableId}`, mime: entrada.tipo === "xml" ? "application/xml" : "application/pdf",
  });
  await tx.vincularDocumentoCargo(entrada.documentoId, entrada.payableId, entrada.tipo, entrada.ahora);
  await listo.auditar(tx.consulta, actorDeCliente(ctx), {
    accion: "documento_cargo_proveedor", identificador: entrada.documentoId, cambio: { tipo: entrada.tipo },
  });
}

async function guardarDocumento(
  tx: ContextoPagos,
  listo: ReturnType<typeof resolver>,
  ctx: ContextoConEmpresa,
  entrada: { documentoId: string; archivo: { nombre: string; bytes: Uint8Array }; ahora: Date; claves: string[]; carpeta: string; mime: string },
): Promise<void> {
  const propuesta = `${ctx.empresa.operadorId}/${ctx.empresa.id}/${entrada.carpeta}/${entrada.documentoId}`;
  const guardado = await listo.almacen.guardar({ clave: propuesta, bytes: entrada.archivo.bytes, tipo: entrada.mime });
  entrada.claves.push(guardado.clave);
  const nombre = entrada.archivo.nombre.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  if (!nombre || nombre.length > 180 || /[\u0000-\u001f\u007f]/.test(nombre)) throw new ErrorDeDominio("archivo_no_disponible");
  await tx.insertarDocumento({
    id: entrada.documentoId, clave: guardado.clave,
    hash: createHash("sha256").update(entrada.archivo.bytes).digest("hex"),
    tipo: entrada.mime, nombre, creadoEn: entrada.ahora,
  });
}

async function limpiarArchivos(almacen: AlmacenConstancia, claves: string[]): Promise<void> {
  for (const clave of claves) await almacen.borrar(clave);
}

function fechaDeEntrada(valor: unknown, original?: string): string {
  return typeof valor === "string" && valor ? valor : original ?? "";
}

function fechaOpcional(valor: unknown): string | null {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

function resolver(deps?: DependenciasPagos) {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    almacen: deps?.almacen ?? almacenVercel(),
    auditar: deps?.auditar ?? auditarPorDefecto,
    ahora: deps?.ahora ?? (() => new Date()),
    id: deps?.id ?? randomUUID,
  };
}
