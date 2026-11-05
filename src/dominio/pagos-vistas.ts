import type { EstadoPago, OrigenPago } from "./pagos-proveedores";

/**
 * Proyecciones serializables compartidas por servidor y componentes de cliente.
 * La CLABE completa y la constancia solo llegan a quien ve el expediente; quien
 * solo solicita recibe la terminación, nunca los 18 dígitos.
 */
export type ProveedorPago = {
  id: string;
  rfc: string;
  razonSocial: string;
  nombreComercial: string | null;
  contactoCorreo: string | null;
  diasCredito: number;
  activo: boolean;
  botonPago: boolean;
  situacion: string | null;
  clabeId: string;
  clabe: string | null;
  clabeFinal: string;
  constanciaId: string | null;
  constancia: string | null;
};

/** Por qué una solicitud por autorizar ya no puede autorizarse tal como está. */
export type BloqueoPago = "clabe_cambiada" | "proveedor_bloqueado" | null;

export type PagoVista = {
  id: string;
  payableId: string;
  supplierId: string;
  proveedor: string;
  rfc: string;
  referencia: string;
  origen: OrigenPago;
  cfdiUuid: string | null;
  totalCentavos: number;
  emitidaEl: string;
  venceEl: string;
  programadaEl: string;
  estado: EstadoPago;
  clabe: string | null;
  clabeFinal: string;
  solicitadoPor: string;
  solicitante: string;
  resueltoPor: string | null;
  motivoResolucion: string | null;
  motivoExcepcion: string | null;
  version: number;
  bloqueo: BloqueoPago;
};

/** Versión cerrada de una solicitud: lo que tenía y quién la resolvió. */
export type VersionPagoVista = {
  version: number;
  estado: EstadoPago;
  estadoNuevo: EstadoPago;
  totalCentavos: number;
  programadaEl: string;
  clabe: string | null;
  clabeFinal: string;
  resolvio: string | null;
  resueltoEn: string | null;
  motivo: string | null;
  cerradoEn: string;
};
