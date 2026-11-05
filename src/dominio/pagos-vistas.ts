import type { EstadoPago, OrigenPago } from "./pagos-proveedores";

/** Proyecciones serializables compartidas por servidor y componentes de cliente. */
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
  clabe: string;
  constanciaId: string;
  constancia: string;
};

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
  solicitadoPor: string;
  solicitante: string;
  resueltoPor: string | null;
  motivoResolucion: string | null;
  motivoExcepcion: string | null;
  version: number;
};
