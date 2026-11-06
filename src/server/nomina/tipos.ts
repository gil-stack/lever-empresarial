import type { ConfiguracionNomina, DestinoNomina } from "../../dominio/nomina";
import type { ContextoConEmpresa } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";

export type ProximaNomina = {
  personaId: string;
  nombre: string;
  areaNombre: string;
  fechaPago: string;
  netoCentavos: number;
  destino: DestinoNomina;
  destinoListo: boolean;
};

/** Agregados calculados en SQL sobre toda la programación, sin el tope de la lista. */
export type TotalesNomina = {
  proximaFecha: string | null;
  netoProximaCentavos: number;
  personasProxima: number;
  destinosPendientes: number;
  programadas: number;
  lotes: number;
  /** La fecha que prepara el botón: la más antigua vencida y sin lote. La calcula el servidor. */
  primeraVencida: string | null;
};

export type LoteResumen = {
  id: string;
  fechaPago: string;
  totalCentavos: number;
  personas: number;
  destinosPendientes: number;
  preparadaEn: string;
};

export type LoteItem = {
  id: string;
  personaId: string;
  nombre: string;
  netoCentavos: number;
  destino: DestinoNomina;
  /** Los 18 dígitos solo para quien puede cambiar la CLABE; los demás ven la terminación. */
  clabe: string | null;
  clabeFinal: string | null;
  destinoListo: boolean;
};

export type LecturaNomina = {
  /** Vacía para quien solo ve totales (contador). */
  proximas: ProximaNomina[];
  /** Falso: el rol ve totales y lotes, no el neto de cada persona. */
  detalle: boolean;
  totales: TotalesNomina;
  lotes: LoteResumen[];
};

export type LecturaLote = {
  lote: LoteResumen;
  /** Vacíos para quien solo ve totales. */
  items: LoteItem[];
  detalle: boolean;
};

export type EmpleadoNomina = {
  id: string;
  altaEn: string;
  bajaEn: string | null;
  clabe: string | null;
};

export type PersonaParaPago = {
  id: string;
  nombre: string;
  netoCentavos: number;
  frecuencia: ConfiguracionNomina["frecuencia"];
  proximoPagoEn: string;
  anclaDia: number;
  destino: DestinoNomina;
  clabe: string | null;
};

export type TransaccionNomina = {
  consulta: Consulta;
  bloquearEmpleado: (id: string) => Promise<EmpleadoNomina | null>;
  perfilAnterior: (id: string) => Promise<{
    netoCentavos: number;
    proximoPagoEn: string;
    frecuencia: ConfiguracionNomina["frecuencia"];
    destino: DestinoNomina;
  } | null>;
  guardarPerfil: (employeeId: string, nomina: ConfiguracionNomina) => Promise<void>;
  tarjetaPendiente: (employeeId: string) => Promise<string | null>;
  solicitarTarjeta: (id: string, employeeId: string, actorId: string) => Promise<void>;
  lotePorFecha: (fecha: string) => Promise<string | null>;
  primeraFechaVencida: (hoy: string) => Promise<string | null>;
  personasParaPago: (fecha: string) => Promise<PersonaParaPago[]>;
  insertarLote: (entrada: { id: string; fecha: string; total: number; actorId: string }) => Promise<void>;
  insertarItem: (entrada: {
    id: string;
    batchId: string;
    employeeId: string;
    nombre: string;
    neto: number;
    destino: DestinoNomina;
    clabe: string | null;
    destinoListo: boolean;
  }) => Promise<void>;
  avanzarPerfil: (employeeId: string, proximoPagoEn: string) => Promise<void>;
};

export type RepositorioNomina = {
  leer: (ctx: ContextoConEmpresa, hoy: string) => Promise<Omit<LecturaNomina, "detalle">>;
  lote: (ctx: ContextoConEmpresa, id: string) => Promise<{ lote: LoteResumen; items: LoteItem[] } | null>;
  conEmpresa: <T>(ctx: ContextoConEmpresa, fn: (tx: TransaccionNomina) => Promise<T>) => Promise<T>;
};
