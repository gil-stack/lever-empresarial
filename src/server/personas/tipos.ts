import type { RolCliente } from "../../nucleo/capacidades";
import type { ContextoConEmpresa } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";

export type CentroVista = {
  id: string;
  nombre: string;
};

export type PersonaVista = {
  id: string;
  userId: string | null;
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  clabe: string;
  jefeId: string | null;
  jefeNombre: string | null;
  centroId: string;
  centroNombre: string;
  roles: RolCliente[];
  /** Tiene acceso pero no ha aceptado su invitación. */
  invitada: boolean;
  correo: string | null;
};

export type LecturaMaestro = {
  centros: CentroVista[];
  personas: PersonaVista[];
  autorizados: string[];
};

export type HechosLiberacion = {
  actorDeBaja: boolean;
  autorizados: number;
};

export type MiembroDeCorreo = {
  id: string;
  tieneEmpleado: boolean;
};

export type PersonaBloqueada = {
  id: string;
  altaEn: string;
  bajaEn: string | null;
  userId: string | null;
  roles: RolCliente[];
};

export type EmpleadoNuevo = {
  id: string;
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  clabe: string;
  jefeId: string | null;
  centroId: string;
  userId: string | null;
};

/** La transacción del maestro, ya en el rol cliente y con la empresa del contexto. */
export type TransaccionMaestro = {
  companyId: string;
  consulta: Consulta;
  centroPorId: (id: string) => Promise<CentroVista | null>;
  centroOcupado: (nombre: string) => Promise<boolean>;
  jefePorId: (id: string) => Promise<PersonaBloqueada | null>;
  bloquearPersona: (id: string) => Promise<PersonaBloqueada | null>;
  miembroPorCorreo: (correo: string) => Promise<MiembroDeCorreo | null>;
  rolesDe: (userId: string) => Promise<RolCliente[]>;
  insertarCentro: (centro: CentroVista) => Promise<void>;
  insertarEmpleado: (empleado: EmpleadoNuevo) => Promise<void>;
  escribirBaja: (id: string, bajaEn: string) => Promise<void>;
  quitarLiberador: (userId: string) => Promise<void>;
};

export type RepositorioPersonas = {
  conEmpresa: <T>(ctx: ContextoConEmpresa, fn: (tx: TransaccionMaestro) => Promise<T>) => Promise<T>;
  leer: (ctx: ContextoConEmpresa, hoy: string) => Promise<LecturaMaestro>;
  resumen: (ctx: ContextoConEmpresa, hoy: string) => Promise<{ nombres: string[] }>;
  hechosLiberacion: (ctx: ContextoConEmpresa, hoy: string) => Promise<HechosLiberacion>;
};
