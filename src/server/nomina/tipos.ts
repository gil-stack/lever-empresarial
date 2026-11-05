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
  clabe: string | null;
  destinoListo: boolean;
};

export type LecturaNomina = {
  proximas: ProximaNomina[];
  lotes: LoteResumen[];
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
  perfilAnterior: (id: string) => Promise<{ netoCentavos: number; proximoPagoEn: string } | null>;
  actualizarClabe: (employeeId: string, clabe: string) => Promise<void>;
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
  leer: (ctx: ContextoConEmpresa, hoy: string) => Promise<LecturaNomina>;
  lote: (ctx: ContextoConEmpresa, id: string) => Promise<{ lote: LoteResumen; items: LoteItem[] } | null>;
  conEmpresa: <T>(ctx: ContextoConEmpresa, fn: (tx: TransaccionNomina) => Promise<T>) => Promise<T>;
};
