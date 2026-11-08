import { createHash, randomUUID } from "node:crypto";

import { leerCfdi, validarPdfPrivado, type CfdiLeido } from "../../dominio/cfdi";
import {
  fechaEnMexico,
  fechaValida,
  montoEscrito,
  textoPago,
  uuidPago,
  validarFechasPago,
  type OrigenPago,
} from "../../dominio/pagos-proveedores";
import { exigir, exigirEmpresa, puede, type ContextoConEmpresa, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirAutenticacionRecienteCliente } from "../autenticacion/reautenticacion";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { almacenVercel, leerPrivado, type AlmacenConstancia } from "../proveedores/constancia";
import type { Sesion } from "../session/tipos";
import { repositorioPg } from "./repositorio";
import type { PagoVista, ProveedorPago, VersionPagoVista } from "../../dominio/pagos-vistas";
import type { CargoNuevo, ContextoPagos, FiltrosPagos, LecturaPagosProveedores, RepositorioPagos } from "./tipos";
import { CONTROL } from "../../dominio/control";

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

/** Un archivo ya validado, con su clave en el almacén y su documento por crear. */
type Subido = { documentoId: string; clave: string; hash: string; nombre: string; mime: string; tipo: "xml" | "pdf" | "evidencia" | "contrato" };

export async function leerPagosProveedores(
  ctx: ContextoDeTenant | null | undefined,
  filtros: FiltrosPagos = {},
  deps?: DependenciasPagos,
): Promise<LecturaPagosProveedores> {
  const conEmpresa = exigir(ctx, "cliente.proveedores.ver");
  const lectura = await resolver(deps).repositorio.leer(conEmpresa, filtros);
  return puede(conEmpresa, "cliente.proveedores.expediente.ver") ? lectura : sinExpediente(lectura);
}

/**
 * Mínimo privilegio para quien solo solicita: ve la terminación de la CLABE,
 * no la CLABE completa, y no recibe constancias ni contratos del proveedor.
 */
export function sinExpediente(lectura: LecturaPagosProveedores): LecturaPagosProveedores {
  const proveedores: ProveedorPago[] = lectura.proveedores.map((proveedor) => ({
    ...proveedor, clabe: null, constanciaId: null, constancia: null,
  }));
  const pagos: PagoVista[] = lectura.pagos.map((pago) => ({ ...pago, clabe: null }));
  const historial: VersionPagoVista[] = lectura.historial.map((version) => ({ ...version, clabe: null }));
  return { ...lectura, proveedores, pagos, historial, documentos: lectura.documentos.filter((documento) => documento.payableId !== null) };
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
  const preparado = prepararPago(entrada, fechaEnMexico(ahora));
  const payableId = listo.id();
  const requestId = listo.id();

  // Lectura previa sin subir nada: el reintento y el UUID repetido no dejan archivos.
  const previo = await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const existente = await tx.solicitudPorClave(clientRequestId);
    if (existente) return existente;
    await exigirProveedor(tx, preparado.supplierId, conEmpresa, preparado.cfdi);
    if (preparado.cfdi && (await tx.cfdiVigente(preparado.cfdi.uuid))) throw new ErrorDeDominio("cfdi_duplicado");
    return null;
  });
  if (previo) return { ...previo, existente: true };

  const archivos = preparado.origen === "cfdi"
    ? [{ archivo: entrada.xml, tipo: "xml" as const }, { archivo: entrada.pdf, tipo: "pdf" as const }]
    : [{ archivo: entrada.pdf, tipo: "evidencia" as const }];
  const subidos: Subido[] = [];
  try {
    // Los archivos suben antes de abrir la transacción con candado de la empresa.
    for (const { archivo, tipo } of archivos) {
      if (!archivo) throw new ErrorDeDominio("archivo_ausente");
      subidos.push(await subir(listo, conEmpresa, { archivo, tipo, carpeta: `pagos/${payableId}` }));
    }
    return await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
      const existente = await tx.solicitudPorClave(clientRequestId);
      if (existente) throw new ErrorDeDominio("idempotencia_pago_duplicada");
      const proveedor = await exigirProveedor(tx, preparado.supplierId, conEmpresa, preparado.cfdi);
      if (!proveedor.clabe) throw new ErrorDeDominio("pago_no_autorizable");
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
      for (const subido of subidos) await ligarDocumentoCargo(tx, listo, conEmpresa, payableId, subido, ahora);
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
    await limpiarArchivos(listo.almacen, subidos);
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
  const evidencia = entrada.pdf ?? null;
  if (evidencia && !validarPdfPrivado(evidencia.nombre, evidencia.bytes).ok) throw new ErrorDeDominio("archivo_no_disponible");

  // Primero se decide si la corrección necesita evidencia nueva, sin subir nada.
  const plan = await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const { cargo } = await solicitudRechazadaPropia(tx, requestId, conEmpresa);
    const preparado = prepararPago({ ...entrada, supplierId: cargo.supplierId, origen: cargo.origen }, hoy, cargo);
    const cambiaMonto = cargo.origen === "excepcion" && (preparado.totalCentavos ?? cargo.totalCentavos) !== cargo.totalCentavos;
    if (cambiaMonto && !evidencia) throw new ErrorDeDominio("evidencia_requerida");
    return { payableId: cargo.id, conEvidencia: cargo.origen === "excepcion" && Boolean(evidencia) };
  });

  const subidos: Subido[] = [];
  try {
    if (plan.conEvidencia && evidencia) {
      subidos.push(await subir(listo, conEmpresa, { archivo: evidencia, tipo: "evidencia", carpeta: `pagos/${plan.payableId}` }));
    }
    await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
      const { solicitud, cargo } = await solicitudRechazadaPropia(tx, requestId, conEmpresa);
      const preparado = prepararPago({ ...entrada, supplierId: cargo.supplierId, origen: cargo.origen }, hoy, cargo);
      const proveedor = await exigirProveedor(tx, cargo.supplierId, conEmpresa, null);
      if (!proveedor.clabe) throw new ErrorDeDominio("pago_no_autorizable");
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
      if (cargo.origen === "excepcion" && actualizado.totalCentavos !== cargo.totalCentavos && subidos.length === 0) {
        throw new ErrorDeDominio("evidencia_requerida");
      }
      // La evidencia nueva queda ligada antes de tocar el importe: la base lo exige.
      for (const subido of subidos) await ligarDocumentoCargo(tx, listo, conEmpresa, cargo.id, subido, ahora);
      await tx.actualizarCargo(actualizado);
      await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
        accion: "editar_cargo_proveedor", identificador: cargo.id, cambio: { total_centavos: actualizado.totalCentavos },
      });
      await tx.reenviarSolicitud({
        id: solicitud.id, actor: conEmpresa.persona.id, version: solicitud.version + 1,
        instantanea: {
          supplierClabeId: proveedor.clabeId, clabe: proveedor.clabe, totalCentavos: actualizado.totalCentavos,
          programadaEl: actualizado.programadaEl, solicitadoEn: ahora,
        },
      });
      await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
        accion: "solicitar_pago_proveedor", identificador: solicitud.id, cambio: { total_centavos: actualizado.totalCentavos },
      });
    });
  } catch (error) {
    await limpiarArchivos(listo.almacen, subidos);
    throw error;
  }
}

/**
 * Autoriza o rechaza exactamente la versión que vio quien decide: su número de
 * versión y su importe viajan con la decisión y deben coincidir con la base.
 */
export async function resolverPagoProveedor(
  ctx: ContextoDeTenant | null | undefined,
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  entrada: { requestId: unknown; decision: "autorizar" | "rechazar"; motivo?: unknown; version: unknown; totalCentavos: unknown },
  deps?: DependenciasPagos,
): Promise<void> {
  const conEmpresa = exigir(ctx, "cliente.pago.liberar");
  exigirAutenticacionRecienteCliente(sesion, deps?.ahora?.() ?? new Date());
  if (!uuidPago(entrada.requestId)) throw new ErrorDeDominio("pago_no_autorizable");
  const version = enteroVisto(entrada.version);
  const totalCentavos = enteroVisto(entrada.totalCentavos);
  if (version === null || totalCentavos === null) throw new ErrorDeDominio("pago_cambio_en_revision");
  const motivo = entrada.decision === "rechazar" ? textoPago(entrada.motivo, 500, 5) : null;
  if (entrada.decision === "rechazar" && !motivo) throw new ErrorDeDominio("motivo_invalido");
  const listo = resolver(deps);
  const ahora = listo.ahora();
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const solicitud = await tx.solicitud(entrada.requestId as string);
    if (!solicitud || solicitud.solicitadoPor === conEmpresa.persona.id) throw new ErrorDeDominio("pago_no_autorizable");
    if (solicitud.estado !== "por_autorizar" || solicitud.version !== version || solicitud.totalCentavos !== totalCentavos) {
      throw new ErrorDeDominio("pago_cambio_en_revision");
    }
    const estado = entrada.decision === "autorizar" ? "listo_para_pagar" : "rechazado";
    await tx.resolverSolicitud({
      id: solicitud.id, desde: "por_autorizar", estado, actor: conEmpresa.persona.id, ahora, motivo, version, totalCentavos,
    });
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
      accion: estado === "listo_para_pagar" ? "autorizar_pago_proveedor" : "rechazar_pago_proveedor",
      identificador: solicitud.id, motivo,
    });
  });
}

/**
 * Cancela con motivo. Quien solicitó cancela mientras espera autorización o
 * tras un rechazo; un liberador o administrador cancela un pago listo para pagar.
 * La cancelación anula el cargo y libera el UUID del CFDI.
 */
export async function cancelarPagoProveedor(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { requestId: unknown; motivo?: unknown },
  deps?: DependenciasPagos,
): Promise<void> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.pago.solicitar") && !puede(conEmpresa, "cliente.pago.cancelar_listo")) {
    throw new ErrorDeDominio("sin_permiso");
  }
  if (!uuidPago(entrada.requestId)) throw new ErrorDeDominio("pago_no_autorizable");
  const motivo = textoPago(entrada.motivo, 500, 5);
  if (!motivo) throw new ErrorDeDominio("motivo_invalido");
  const listo = resolver(deps);
  const ahora = listo.ahora();
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const solicitud = await tx.solicitud(entrada.requestId as string);
    const propia = solicitud?.solicitadoPor === conEmpresa.persona.id && puede(conEmpresa, "cliente.pago.solicitar");
    const permitida = solicitud && (
      ((solicitud.estado === "por_autorizar" || solicitud.estado === "rechazado") && propia)
      || (solicitud.estado === "listo_para_pagar" && puede(conEmpresa, "cliente.pago.cancelar_listo"))
    );
    if (!solicitud || !permitida) throw new ErrorDeDominio("cancelacion_no_permitida");
    await tx.resolverSolicitud({
      id: solicitud.id, desde: solicitud.estado, estado: "cancelado", actor: conEmpresa.persona.id, ahora, motivo,
      version: solicitud.version, totalCentavos: solicitud.totalCentavos,
    });
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
  const supplierId = entrada.supplierId;
  const pdf = entrada.pdf;
  if (!validarPdfPrivado(pdf.nombre, pdf.bytes).ok) throw new ErrorDeDominio("archivo_no_disponible");
  const desde = fechaOpcional(entrada.vigenteDesde);
  const hasta = fechaOpcional(entrada.vigenteHasta);
  // «Vigente desde» que no existe marca su campo; «hasta» que no existe o queda antes de «desde», el suyo.
  if (entrada.vigenteDesde && !desde) throw new ErrorDeDominio("fecha_desde_invalida");
  if ((entrada.vigenteHasta && !hasta) || (desde && hasta && hasta < desde)) throw new ErrorDeDominio("fecha_invalida");
  const listo = resolver(deps);
  const ahora = listo.ahora();
  const existe = await listo.repositorio.conEmpresa(conEmpresa, async (tx) => Boolean(await tx.proveedor(supplierId)));
  if (!existe) throw new ErrorDeDominio("proveedor_ausente");
  const subidos: Subido[] = [];
  try {
    const subido = await subir(listo, conEmpresa, { archivo: pdf, tipo: "contrato", carpeta: `proveedores/${supplierId}/contratos` });
    subidos.push(subido);
    await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
      const proveedor = await tx.proveedor(supplierId);
      if (!proveedor) throw new ErrorDeDominio("proveedor_ausente");
      await tx.insertarDocumento({ id: subido.documentoId, clave: subido.clave, hash: subido.hash, tipo: subido.mime, nombre: subido.nombre, creadoEn: ahora });
      await tx.vincularDocumentoProveedor(subido.documentoId, proveedor.id, "contrato", desde, hasta, ahora);
      await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
        accion: "documento_proveedor", identificador: subido.documentoId, cambio: { tipo: "contrato" },
      });
    });
  } catch (error) {
    await limpiarArchivos(listo.almacen, subidos);
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
  // Constancias y contratos son del expediente: quien solo solicita no los descarga.
  if (documento.ambito === "proveedor" && !puede(conEmpresa, "cliente.proveedores.expediente.ver")) {
    throw new ErrorDeDominio("archivo_no_disponible");
  }
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

async function solicitudRechazadaPropia(tx: ContextoPagos, requestId: string, ctx: ContextoConEmpresa) {
  const solicitud = await tx.solicitud(requestId);
  if (!solicitud || solicitud.estado !== "rechazado" || solicitud.solicitadoPor !== ctx.persona.id) {
    throw new ErrorDeDominio("pago_no_autorizable");
  }
  const cargo = await tx.cargo(solicitud.payableId);
  if (!cargo) throw new ErrorDeDominio("pago_no_autorizable");
  return { solicitud, cargo };
}

async function exigirProveedor(tx: ContextoPagos, supplierId: string, ctx: ContextoConEmpresa, cfdi: CfdiLeido | null): Promise<ProveedorPago> {
  const proveedor = await tx.proveedor(supplierId);
  if (!proveedor || !proveedor.activo || !proveedor.botonPago) throw new ErrorDeDominio("pago_no_autorizable");
  if (cfdi && cfdi.rfcEmisor !== proveedor.rfc) throw new ErrorDeDominio("cfdi_emisor_distinto");
  if (cfdi && cfdi.rfcReceptor !== ctx.empresa.rfc) throw new ErrorDeDominio("cfdi_receptor_distinto");
  return proveedor;
}

/** Sube un archivo ya validado. Se llama fuera de la transacción con candado. */
async function subir(
  listo: ReturnType<typeof resolver>,
  ctx: ContextoConEmpresa,
  entrada: { archivo: { nombre: string; bytes: Uint8Array }; tipo: Subido["tipo"]; carpeta: string },
): Promise<Subido> {
  const nombre = entrada.archivo.nombre.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  if (!nombre || nombre.length > 180 || CONTROL.test(nombre)) throw new ErrorDeDominio("archivo_no_disponible");
  const documentoId = listo.id();
  const mime = entrada.tipo === "xml" ? "application/xml" : "application/pdf";
  const propuesta = `${ctx.empresa.operadorId}/${ctx.empresa.id}/${entrada.carpeta}/${documentoId}`;
  const guardado = await listo.almacen.guardar({ clave: propuesta, bytes: entrada.archivo.bytes, tipo: mime });
  return {
    documentoId, clave: guardado.clave, nombre, mime, tipo: entrada.tipo,
    hash: createHash("sha256").update(entrada.archivo.bytes).digest("hex"),
  };
}

async function ligarDocumentoCargo(
  tx: ContextoPagos,
  listo: ReturnType<typeof resolver>,
  ctx: ContextoConEmpresa,
  payableId: string,
  subido: Subido,
  ahora: Date,
): Promise<void> {
  if (subido.tipo === "contrato") throw new ErrorDeDominio("archivo_no_disponible");
  await tx.insertarDocumento({ id: subido.documentoId, clave: subido.clave, hash: subido.hash, tipo: subido.mime, nombre: subido.nombre, creadoEn: ahora });
  await tx.vincularDocumentoCargo(subido.documentoId, payableId, subido.tipo, ahora);
  await listo.auditar(tx.consulta, actorDeCliente(ctx), {
    accion: "documento_cargo_proveedor", identificador: subido.documentoId, cambio: { tipo: subido.tipo },
  });
}

async function limpiarArchivos(almacen: AlmacenConstancia, subidos: readonly Subido[]): Promise<void> {
  for (const subido of subidos) await almacen.borrar(subido.clave);
}

function enteroVisto(valor: unknown): number | null {
  const texto = typeof valor === "number" ? String(valor) : typeof valor === "string" ? valor.trim() : "";
  if (!/^\d{1,16}$/.test(texto)) return null;
  const numero = Number(texto);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function fechaDeEntrada(valor: unknown, original?: string): string {
  return typeof valor === "string" && valor ? valor : original ?? "";
}

function fechaOpcional(valor: unknown): string | null {
  return fechaValida(valor) ? valor : null;
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
