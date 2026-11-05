import type { EstadoPago, OrigenPago } from "../../dominio/pagos-proveedores";
import type { PagoVista, ProveedorPago } from "../../dominio/pagos-vistas";
import type { ContextoConEmpresa } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";

export type { PagoVista, ProveedorPago } from "../../dominio/pagos-vistas";

export type DocumentoVista = {
  id: string;
  nombre: string;
  tipo: string;
  supplierId: string | null;
  payableId: string | null;
  vigenteHasta: string | null;
};

export type ActividadVista = {
  id: string;
  accion: string;
  identificador: string | null;
  actor: string;
  ocurridoEn: string;
};

export type MetricasPagos = {
  porVencer: { cantidad: number; centavos: number };
  vencidos: { cantidad: number; centavos: number };
  porAutorizar: { cantidad: number; centavos: number };
  listos: { cantidad: number; centavos: number };
};

export type LecturaPagosProveedores = {
  proveedores: ProveedorPago[];
  pagos: PagoVista[];
  documentos: DocumentoVista[];
  actividad: ActividadVista[];
  metricas: MetricasPagos;
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
  solicitud(id: string): Promise<SolicitudActual | null>;
  actualizarCargo(cargo: CargoNuevo & { actualizadoEn: Date }): Promise<void>;
  actualizarSolicitud(entrada: {
    id: string;
    estado: EstadoPago;
    actor: string;
    ahora: Date;
    motivo: string | null;
    version: number;
    instantanea?: { supplierClabeId: string; clabe: string; totalCentavos: number; programadaEl: string; solicitadoEn: Date };
  }): Promise<void>;
};

export type RepositorioPagos = {
  leer(ctx: ContextoConEmpresa, filtros: FiltrosPagos): Promise<LecturaPagosProveedores>;
  conEmpresa<T>(ctx: ContextoConEmpresa, fn: (tx: ContextoPagos) => Promise<T>): Promise<T>;
  documento(ctx: ContextoConEmpresa, id: string): Promise<{ id: string; clave: string; hash: string; nombre: string; tipo: string } | null>;
};
