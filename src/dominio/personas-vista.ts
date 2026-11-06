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
  /** Vacío para quien no prepara ni autoriza la nómina: ve totales, no el neto de cada persona. */
  netoCentavos: number | null;
  frecuencia: FrecuenciaNomina;
  proximoPagoEn: string;
  destino: DestinoNomina;
  activa: boolean;
};

export type PersonaVista = {
  id: string;
  /** Usuario de plataforma, si la persona tiene cuenta. Lo usa la casilla de Finanzas. */
  userId: string | null;
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  /** Los 18 dígitos solo para quien puede cambiar la CLABE; para los demás, vacío. */
  clabe: string | null;
  /** Últimos cuatro dígitos de la CLABE vigente, para todos los que ven el maestro. */
  clabeFinal: string | null;
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

export type ClabeHistorialVista = {
  id: string;
  /** Enmascarada: «•••• 1234». El historial nunca muestra los 18 dígitos. */
  visible: string;
  desde: string;
  hasta: string | null;
  registradaPor: string | null;
};

export type DetallePersona = {
  persona: PersonaVista;
  centros: CentroVista[];
  jefes: Array<{ id: string; nombre: string }>;
  clabeDuplicada: boolean;
  historialClabe: ClabeHistorialVista[];
};
