import type { EstadoPago, OrigenPago } from "../../dominio/pagos-proveedores";
import type { PagoVista, ProveedorPago, VersionPagoVista } from "../../dominio/pagos-vistas";
import type { ContextoConEmpresa } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";

export type { PagoVista, ProveedorPago, VersionPagoVista } from "../../dominio/pagos-vistas";

export type DocumentoVista = {
  id: string;
  nombre: string;
  tipo: string;
  supplierId: string | null;
  payableId: string | null;
  vigenteHasta: string | null;
};

/** A qué está ligado un documento descargable: al expediente del proveedor o a un cargo. */
export type AmbitoDocumento = "proveedor" | "cargo";

export type ActividadVista = {
  id: string;
  accion: string;
  identificador: string | null;
  actor: string;
  ocurridoEn: string;
};

/** Las sumas viajan como entero en texto: pueden pasar de 2^53 centavos. */
export type MetricaPagos = { cantidad: number; centavos: string };

export type MetricasPagos = {
  porVencer: MetricaPagos;
  vencidos: MetricaPagos;
  porAutorizar: MetricaPagos;
  listos: MetricaPagos;
};

export type LecturaPagosProveedores = {
  proveedores: ProveedorPago[];
  pagos: PagoVista[];
  documentos: DocumentoVista[];
  actividad: ActividadVista[];
  /** Las últimas 12 autorizaciones y rechazos, de la más reciente a la más antigua (el historial de Aprobaciones). */
  decisiones: ActividadVista[];
  metricas: MetricasPagos;
  /** Versiones cerradas del pago abierto en el detalle, de la más reciente a la más antigua. */
  historial: VersionPagoVista[];
  pagina: number;
  hayMas: boolean;
};

export type FiltrosPagos = { q?: string; estado?: string; pagina?: number; pagoId?: string };

export type DocumentoNuevoPago = {
  id: string;
  clave: string;
  hash: string;
  tipo: string;
  nombre: string;
  creadoEn: Date;
};

export type CargoNuevo = {
  id: string;
  supplierId: string;
  origen: OrigenPago;
  cfdiUuid: string | null;
  serie: string | null;
  folio: string | null;
  referencia: string;
  totalCentavos: number;
  emitidaEl: string;
  venceEl: string;
  programadaEl: string;
  motivoExcepcion: string | null;
  creadoPor: string;
  creadoEn: Date;
};

export type SolicitudNueva = {
  id: string;
  payableId: string;
  clientRequestId: string;
  supplierClabeId: string;
  clabe: string;
  totalCentavos: number;
  programadaEl: string;
  solicitadoPor: string;
  solicitadoEn: Date;
};

export type SolicitudActual = {
  id: string;
  payableId: string;
  estado: EstadoPago;
  solicitadoPor: string;
  version: number;
  totalCentavos: number;
};

export type ContextoPagos = {
  companyId: string;
  consulta: Consulta;
  proveedor(supplierId: string): Promise<ProveedorPago | null>;
  insertarDocumento(documento: DocumentoNuevoPago): Promise<void>;
  vincularDocumentoProveedor(documentoId: string, supplierId: string, tipo: string, vigenteDesde: string | null, vigenteHasta: string | null, creadoEn: Date): Promise<void>;
  insertarCargo(cargo: CargoNuevo): Promise<void>;
  cargo(payableId: string): Promise<CargoNuevo | null>;
  vincularDocumentoCargo(documentoId: string, payableId: string, tipo: string, creadoEn: Date): Promise<void>;
  insertarSolicitud(solicitud: SolicitudNueva): Promise<void>;
  solicitudPorClave(clientRequestId: string): Promise<{ requestId: string; payableId: string } | null>;
  /** Verdadero si el UUID ya está en un cargo vigente (no anulado) de la empresa. */
  cfdiVigente(uuid: string): Promise<boolean>;
  solicitud(id: string): Promise<SolicitudActual | null>;
  actualizarCargo(cargo: CargoNuevo & { actualizadoEn: Date }): Promise<void>;
  /** Resuelve o cancela. Solo cambia la fila si sigue en `desde`, con la versión y el importe esperados. */
  resolverSolicitud(entrada: {
    id: string;
    desde: EstadoPago;
    estado: Exclude<EstadoPago, "por_autorizar">;
    actor: string;
    ahora: Date;
    motivo: string | null;
    version: number;
    totalCentavos: number;
  }): Promise<void>;
  /** Vuelve a solicitar una rechazada con la instrucción nueva y la versión siguiente. */
  reenviarSolicitud(entrada: {
    id: string;
    actor: string;
    version: number;
    instantanea: { supplierClabeId: string; clabe: string; totalCentavos: number; programadaEl: string; solicitadoEn: Date };
  }): Promise<void>;
};

export type RepositorioPagos = {
  leer(ctx: ContextoConEmpresa, filtros: FiltrosPagos): Promise<LecturaPagosProveedores>;
  conEmpresa<T>(ctx: ContextoConEmpresa, fn: (tx: ContextoPagos) => Promise<T>): Promise<T>;
  documento(ctx: ContextoConEmpresa, id: string): Promise<{ id: string; clave: string; hash: string; nombre: string; tipo: string; ambito: AmbitoDocumento } | null>;
};
