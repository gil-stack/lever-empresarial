import type { RolCliente, RolPlataforma } from "../../nucleo/capacidades";

/** Lo que el correo necesita. No lleva contraseña ni el hash del token. */
export type MensajeDeInvitacion = {
  invitacionId: string;
  para: string;
  nombre: string;
  /** Vacío cuando la invitación es al personal del operador. */
  razonSocial: string | null;
  roles: readonly (RolCliente | RolPlataforma)[];
  /** Enlace de un solo uso. Solo viaja a este correo. */
  enlace: string;
  expiraEn: Date;
};

/**
 * Puerto de envío. Otro frente lo implementa con el proveedor de correo
 * transaccional. Si lanza, la invitación queda emitida y se puede reenviar.
 */
export type EnviarInvitacion = (mensaje: MensajeDeInvitacion) => Promise<void>;

export type InvitacionEmitida = {
  invitacionId: string;
  userId: string;
  companyId: string | null;
  correo: string;
  nombre: string;
  roles: readonly (RolCliente | RolPlataforma)[];
  /** El token en claro existe solo aquí, para armar el enlace. La base guarda su SHA-256. */
  token: string;
  expiraEn: Date;
};

export type ResultadoDeEntrega = { entregada: true } | { entregada: false; codigo: string };

export type EstadoDeInvitacion = "vigente" | "usada" | "vencida" | "revocada" | "inexistente";

/** Lo que ve quien abre el enlace, antes de aceptar. */
export type VistaDeInvitacion =
  | { estado: Exclude<EstadoDeInvitacion, "vigente"> }
  | {
      estado: "vigente";
      nombre: string;
      correo: string;
      razonSocial: string | null;
      /** Verdadero si la persona ya tiene contraseña: confirma con ella en lugar de fijar una. */
      yaTieneContrasena: boolean;
      expiraEn: Date;
    };

export type InvitacionLeida = {
  id: string;
  operadorId: string;
  companyId: string | null;
  userId: string;
  nombre: string;
  correo: string;
  razonSocial: string | null;
  tieneContrasena: boolean;
  expiraEn: Date;
  usadaEn: Date | null;
  revocadaEn: Date | null;
};
