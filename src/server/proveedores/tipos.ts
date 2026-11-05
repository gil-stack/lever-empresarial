import type { InstitucionClabe } from "../../dominio/clabe-proveedor";
import type { DecisionPago, ListaVisible, ProveedorVisible } from "../../dominio/proveedores";
import type { ContextoConEmpresa } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";

export type LecturaLista = {
  snapshotId: string | null;
  fechaArchivo: string | null;
  situaciones: string[];
};

export type DocumentoNuevo = {
  id: string;
  clave: string;
  hash: string;
  tipo: string;
  nombre: string;
  creadoEn: Date;
};

export type ProveedorNuevo = {
  id: string;
  documentId: string;
  snapshotId: string | null;
  rfc: string;
  razonSocial: string;
  situacion: string | null;
  fechaArchivo: string | null;
  leidaEn: Date;
  botonPago: boolean;
  nombreComercial: string | null;
  contactoCorreo: string | null;
  diasCredito: number;
  altaEn: Date;
};

export type ClabeNueva = {
  id: string;
  supplierId: string;
  clabe: string;
  desde: Date;
};

export type ContextoProveedores = {
  companyId: string;
  consulta: Consulta;
  rfcOcupado(rfc: string): Promise<boolean>;
  leerLista(rfc: string): Promise<LecturaLista>;
  insertarDocumento(documento: DocumentoNuevo): Promise<void>;
  insertarProveedor(proveedor: ProveedorNuevo): Promise<void>;
  insertarClabe(clabe: ClabeNueva): Promise<void>;
  vincularContrato(documentoId: string, supplierId: string, vigenteDesde: string | null, vigenteHasta: string | null, creadoEn: Date): Promise<void>;
};

export type LecturaProveedores = {
  lista: ListaVisible;
  proveedores: ProveedorVisible[];
};

export type AltaGuardada = {
  id: string;
  decision: DecisionPago;
};

export type RepositorioProveedores = {
  conEmpresa<T>(ctx: ContextoConEmpresa, fn: (tx: ContextoProveedores) => Promise<T>): Promise<T>;
  leer(ctx: ContextoConEmpresa): Promise<LecturaProveedores>;
};

export type FilaClabe = {
  id: string;
  supplierId: string;
  clabe: string;
  desde: Date;
  hasta: Date | null;
};

export type FilaNueva = {
  id: string;
  supplierId: string;
  clabe: string;
  desde: Date;
};

export type ContextoClabes = {
  companyId: string;
  consulta: Consulta;
  vigente: (supplierId: string) => Promise<FilaClabe | null>;
  cerrar: (id: string, hasta: Date) => Promise<void>;
  insertar: (fila: FilaNueva) => Promise<void>;
};

export type RepositorioClabes = {
  listar: (ctx: ContextoConEmpresa) => Promise<FilaClabe[]>;
  conEmpresa: <T>(ctx: ContextoConEmpresa, fn: (tx: ContextoClabes) => Promise<T>) => Promise<T>;
};

export type LineaClabeVista = {
  id: string;
  visible: string;
  institucion: InstitucionClabe;
  desde: string;
  hasta: string | null;
  orden: number;
};

export type GrupoClabeVista = {
  supplierId: string;
  vigente: LineaClabeVista | null;
  anteriores: LineaClabeVista[];
};

export type LecturaClabes = {
  puedeCambiar: boolean;
  grupos: GrupoClabeVista[];
};
