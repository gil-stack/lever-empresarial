import type { InstitucionClabe } from "../../dominio/clabe-proveedor";
import type { DecisionPago, ListaVisible, ProveedorVisible } from "../../dominio/proveedores";
import type { Consulta } from "../session/db";
import type { Rol } from "../session/tipos";

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
  altaEn: Date;
};

export type ClabeNueva = {
  id: string;
  supplierId: string;
  clabe: string;
  desde: Date;
};

export type SnapshotNuevo = {
  id: string;
  fechaArchivo: string;
  cargadoEn: Date;
  filas: { rfc: string; situacion: string }[];
};

export type ContextoProveedores = {
  companyId: string;
  rol: Rol;
  consulta: Consulta;
  rfcOcupado(rfc: string): Promise<boolean>;
  leerLista(rfc: string): Promise<LecturaLista>;
  insertarDocumento(documento: DocumentoNuevo): Promise<void>;
  insertarProveedor(proveedor: ProveedorNuevo): Promise<void>;
  insertarClabe(clabe: ClabeNueva): Promise<void>;
};

export type LecturaProveedores = {
  rol: Rol;
  lista: ListaVisible;
  proveedores: ProveedorVisible[];
};

export type AltaGuardada = {
  id: string;
  decision: DecisionPago;
};

export type RepositorioProveedores = {
  conEmpresa<T>(userId: string, fn: (ctx: ContextoProveedores) => Promise<T>): Promise<T>;
  leer(userId: string): Promise<LecturaProveedores | null>;
  guardarSnapshot(snapshot: SnapshotNuevo): Promise<void>;
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
  rol: Rol;
  consulta: Consulta;
  vigente: (supplierId: string) => Promise<FilaClabe | null>;
  cerrar: (id: string, hasta: Date) => Promise<void>;
  insertar: (fila: FilaNueva) => Promise<void>;
};

export type RepositorioClabes = {
  puerta: (userId: string) => Promise<{ rol: Rol } | null>;
  listar: (userId: string) => Promise<FilaClabe[]>;
  conEmpresa: <T>(userId: string, fn: (ctx: ContextoClabes) => Promise<T>) => Promise<T>;
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
