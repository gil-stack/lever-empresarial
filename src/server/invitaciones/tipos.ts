import type { Consulta } from "../session/db";
import type { Rol } from "../session/tipos";

/**
 * Contrato con la tenencia (rama fase-4/tenencia).
 *
 * Este módulo no deduce la empresa del usuario: recibe un contexto ya
 * resuelto y pregunta por una capacidad. La unión de la persona a la empresa
 * pasa por `unirAEmpresa`, que hoy escribe la membresía de un solo rol y que
 * la tenencia reemplaza por membresía con estado y varios roles.
 */

export type TipoActor = "miembro" | "personal_sofipo" | "sistema";

export type CapacidadInvitacion = "invitar_usuarios" | "invitar_empresa";

export type ContextoInvitacion = {
  tipoActor: TipoActor;
  /** Persona que actúa. Vacío solo cuando el actor es el sistema. */
  actorId: string | null;
  /** Empresa elegida y validada contra las membresías. Vacía en actos de plataforma. */
  companyId: string | null;
  capacidades: ReadonlySet<CapacidadInvitacion>;
};

export type TipoInvitacion = "empresa" | "usuario";

export type InvitacionNueva = {
  id: string;
  companyId: string;
  tipo: TipoInvitacion;
  correo: string;
  nombre: string;
  roles: readonly Rol[];
  tokenHash: string;
  invitadoPor: string | null;
  creadaEn: Date;
  venceEn: Date;
};

export type InvitacionLeida = {
  id: string;
  companyId: string;
  tipo: TipoInvitacion;
  correo: string;
  nombre: string;
  roles: Rol[];
  venceEn: Date;
  aceptadaEn: Date | null;
  revocadaEn: Date | null;
  razonSocial: string;
  rfc: string;
  quienInvita: string | null;
  cuentaExistente: boolean;
};

export type InvitacionConsumida = {
  id: string;
  companyId: string;
  correo: string;
  roles: Rol[];
};

export type EmpresaDeInvitacion = { id: string; razonSocial: string; rfc: string };

export type CuentaExistente = { id: string; nombre: string; passwordHash: string };

export type UsuarioNuevo = {
  id: string;
  nombre: string;
  correo: string;
  passwordHash: string;
  /** Abrir el enlace del correo prueba que la persona controla la dirección. */
  verificadoEn: Date;
};

export type TransaccionInvitaciones = {
  consulta: Consulta;
  revocarPendientes: (companyId: string, correo: string, ahora: Date) => Promise<string[]>;
  insertar: (invitacion: InvitacionNueva) => Promise<void>;
  /** Un solo uso: marca la aceptación solo si sigue pendiente y vigente. */
  consumir: (tokenHash: string, ahora: Date, userId: string) => Promise<InvitacionConsumida | null>;
  revocar: (id: string, companyId: string, ahora: Date) => Promise<boolean>;
  crearUsuario: (usuario: UsuarioNuevo) => Promise<void>;
  marcarCorreoVerificado: (userId: string, ahora: Date) => Promise<void>;
  /** Puerta de la tenencia. */
  unirAEmpresa: (union: { userId: string; companyId: string; roles: readonly Rol[] }) => Promise<void>;
};

export type RepositorioInvitaciones = {
  /** Hoy la membresía guarda un rol. La tenencia lo cambia a verdadero. */
  rolesCombinables: boolean;
  empresa: (companyId: string) => Promise<EmpresaDeInvitacion | null>;
  nombreDe: (userId: string) => Promise<string | null>;
  esMiembro: (correo: string, companyId: string) => Promise<boolean>;
  buscarPorTokenHash: (tokenHash: string) => Promise<InvitacionLeida | null>;
  cuentaPorCorreo: (correo: string) => Promise<CuentaExistente | null>;
  conTransaccion: <T>(fn: (tx: TransaccionInvitaciones) => Promise<T>) => Promise<T>;
};

export type RecuperacionNueva = {
  id: string;
  userId: string;
  tokenHash: string;
  creadoEn: Date;
  venceEn: Date;
};

export type CuentaDeRecuperacion = { id: string; nombre: string; correo: string };

export type TransaccionRecuperacion = {
  consulta: Consulta;
  recientes: (userId: string, desde: Date) => Promise<number>;
  anularPendientes: (userId: string, ahora: Date) => Promise<void>;
  insertar: (recuperacion: RecuperacionNueva) => Promise<void>;
  anular: (id: string, ahora: Date) => Promise<void>;
  /** Un solo uso: devuelve la persona solo si el token seguía pendiente y vigente. */
  consumir: (tokenHash: string, ahora: Date) => Promise<string | null>;
  cambiarContrasena: (userId: string, passwordHash: string) => Promise<void>;
  marcarCorreoVerificado: (userId: string, ahora: Date) => Promise<void>;
  cerrarSesiones: (userId: string) => Promise<void>;
};

export type EstadoRecuperacionLeida = {
  venceEn: Date;
  usadoEn: Date | null;
  anuladoEn: Date | null;
};

export type RepositorioRecuperacion = {
  cuentaPorCorreo: (correo: string) => Promise<CuentaDeRecuperacion | null>;
  buscarPorTokenHash: (tokenHash: string) => Promise<EstadoRecuperacionLeida | null>;
  conTransaccion: <T>(fn: (tx: TransaccionRecuperacion) => Promise<T>) => Promise<T>;
};
