import type { RolCliente } from "../nucleo/capacidades";
import type { DestinoNomina, FrecuenciaNomina } from "./nomina";

export type CentroVista = {
  id: string;
  nombre: string;
  presupuestoCentavos: number | null;
  esTesoreria: boolean;
};

export type AreaVista = CentroVista & {
  personas: number;
  nominaMensualCentavos: number;
  presupuestosIndividualesCentavos: number;
  disponibleCentavos: number | null;
};

export type NominaPersonaVista = {
  netoCentavos: number;
  frecuencia: FrecuenciaNomina;
  proximoPagoEn: string;
  destino: DestinoNomina;
  activa: boolean;
};

export type PersonaVista = {
  id: string;
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  clabe: string | null;
  presupuestoCentavos: number | null;
  jefeId: string | null;
  jefeNombre: string | null;
  centroId: string;
  centroNombre: string;
  roles: RolCliente[];
  membresia: "invitada" | "activa" | "suspendida" | null;
  invitada: boolean;
  correo: string | null;
  nomina: NominaPersonaVista | null;
  tarjetaPendiente: boolean;
};

export type ResumenPersonas = {
  vigentes: number;
  porConfigurar: number;
  nominaMensualCentavos: number;
  proximoPagoEn: string | null;
  proximoPagoCentavos: number;
};

export type FiltrosPersonas = {
  buscar: string;
  centroId: string | null;
  estado: "todos" | "vigentes" | "pendientes" | "bajas";
  pagina: number;
};

export type LecturaMaestro = {
  centros: CentroVista[];
  personas: PersonaVista[];
  areas: AreaVista[];
  resumen: ResumenPersonas;
  autorizados: string[];
  jefes: Array<{ id: string; nombre: string }>;
  total: number;
  pagina: number;
  porPagina: number;
};

export type DetallePersona = {
  persona: PersonaVista;
  centros: CentroVista[];
  jefes: Array<{ id: string; nombre: string }>;
  clabeDuplicada: boolean;
};
