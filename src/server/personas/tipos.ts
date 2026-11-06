import type { ConfiguracionNomina } from "../../dominio/nomina";
import type {
  CentroVista,
  DetallePersona,
  FiltrosPersonas,
  LecturaMaestro,
} from "../../dominio/personas-vista";
import type { RolCliente } from "../../nucleo/capacidades";
import type { ContextoConEmpresa } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";

export type {
  AreaVista,
  CentroVista,
  ClabeHistorialVista,
  DetallePersona,
  FiltrosPersonas,
  LecturaMaestro,
  NominaPersonaVista,
  PersonaVista,
  ResumenPersonas,
} from "../../dominio/personas-vista";

export type HechosLiberacion = {
  actorDeBaja: boolean;
  autorizados: number;
};

export type MiembroDeCorreo = {
  id: string;
  tieneEmpleado: boolean;
  estado: "invitada" | "activa" | "suspendida";
};

export type PersonaBloqueada = {
  id: string;
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  userId: string | null;
  roles: RolCliente[];
  clabe: string | null;
  centroId: string;
  jefeId: string | null;
  presupuestoCentavos: number | null;
  membresia: "invitada" | "activa" | "suspendida" | null;
  correo: string | null;
};

export type EmpleadoNuevo = {
  id: string;
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  clabe: string | null;
  presupuestoCentavos: number | null;
  altaLlave: string | null;
  jefeId: string | null;
  centroId: string;
  userId: string | null;
};

export type ActualizacionPersona = Omit<EmpleadoNuevo, "userId" | "altaLlave" | "bajaEn" | "clabe">;

export type ClabeNueva = {
  id: string;
  employeeId: string;
  clabe: string;
  desde: Date;
  actorId: string;
};

/** La transacción del maestro, ya en el rol cliente y con la empresa del contexto. */
export type TransaccionMaestro = {
  companyId: string;
  consulta: Consulta;
  centroPorId: (id: string) => Promise<CentroVista | null>;
  centroOcupado: (nombre: string, exceptoId?: string) => Promise<boolean>;
  jefePorId: (id: string) => Promise<PersonaBloqueada | null>;
  bloquearPersona: (id: string) => Promise<PersonaBloqueada | null>;
  miembroPorCorreo: (correo: string) => Promise<MiembroDeCorreo | null>;
  rolesDe: (userId: string) => Promise<RolCliente[]>;
  empleadoPorLlave: (llave: string) => Promise<{ id: string; nombre: string } | null>;
  jefeCreaCiclo: (personaId: string, jefeId: string) => Promise<boolean>;
  clabeDuplicada: (clabe: string, exceptoId: string) => Promise<boolean>;
  insertarCentro: (centro: Omit<CentroVista, "id"> & { id: string }) => Promise<void>;
  actualizarCentro: (centro: CentroVista) => Promise<void>;
  insertarEmpleado: (empleado: EmpleadoNuevo) => Promise<void>;
  actualizarEmpleado: (empleado: ActualizacionPersona) => Promise<void>;
  insertarNomina: (employeeId: string, nomina: ConfiguracionNomina) => Promise<void>;
  proximoPago: (employeeId: string) => Promise<string | null>;
  nominaActiva: (employeeId: string) => Promise<boolean>;
  desactivarNomina: (employeeId: string) => Promise<void>;
  solicitarTarjeta: (entrada: { id: string; employeeId: string; actorId: string }) => Promise<void>;
  tarjetasPendientes: (employeeId: string) => Promise<string[]>;
  cancelarTarjeta: (id: string) => Promise<void>;
  escribirBaja: (id: string, bajaEn: string | null) => Promise<void>;
  /** Administradores con membresía activa y sin baja registrada, sin contar a esta persona. */
  administradoresVigentes: (exceptoUserId: string) => Promise<number>;
  cerrarClabe: (employeeId: string, hasta: Date) => Promise<void>;
  insertarClabe: (clabe: ClabeNueva) => Promise<void>;
  escribirClabe: (employeeId: string, clabe: string) => Promise<void>;
  quitarLiberador: (userId: string) => Promise<void>;
  desprovisionar: (userId: string) => Promise<void>;
  personaParaInvitacion: (personaId: string) => Promise<{
    userId: string;
    nombre: string;
    correo: string;
    roles: RolCliente[];
  } | null>;
};

export type RepositorioPersonas = {
  conEmpresa: <T>(ctx: ContextoConEmpresa, fn: (tx: TransaccionMaestro) => Promise<T>) => Promise<T>;
  leer: (ctx: ContextoConEmpresa, hoy: string, filtros: FiltrosPersonas) => Promise<LecturaMaestro>;
  detalle: (ctx: ContextoConEmpresa, hoy: string, personaId: string) => Promise<DetallePersona | null>;
  resumen: (ctx: ContextoConEmpresa, hoy: string) => Promise<{ nombres: string[] }>;
  hechosLiberacion: (ctx: ContextoConEmpresa, hoy: string) => Promise<HechosLiberacion>;
};
