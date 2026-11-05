export {
  agregarContratoProveedor,
  cancelarPagoProveedor,
  crearPagoProveedor,
  descargarDocumentoProveedor,
  editarYReenviarPago,
  inspeccionarCfdi,
  leerPagosProveedores,
  resolverPagoProveedor,
} from "./servicio";
export type { ArchivoPago, DependenciasPagos, EntradaPago } from "./servicio";
export type { LecturaPagosProveedores, PagoVista, ProveedorPago } from "./tipos";
