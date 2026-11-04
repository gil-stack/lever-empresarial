export type EstadoInvitacion = { tipo: "inicial" } | { tipo: "invalido"; mensaje: string };

export const INVITACION_INICIAL: EstadoInvitacion = { tipo: "inicial" };
