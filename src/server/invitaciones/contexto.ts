import type { Sesion } from "../session/tipos";
import type { CapacidadInvitacion, ContextoInvitacion } from "./tipos";

const NINGUNA: ReadonlySet<CapacidadInvitacion> = new Set();

/**
 * Puente con la sesión de hoy, mientras la tenencia no entrega su contexto
 * por petición. Solo el administrador de la empresa de la sesión invita.
 * Cuando exista la matriz de capacidades, este archivo se borra.
 */
export function contextoDesdeSesion(sesion: Sesion | null | undefined): ContextoInvitacion {
  const actorId = sesion?.usuario?.id ?? null;
  const companyId = sesion?.companyId ?? null;
  const capacidades: ReadonlySet<CapacidadInvitacion> =
    actorId && companyId && sesion?.rol === "administrador" ? new Set(["invitar_usuarios"]) : NINGUNA;
  return { tipoActor: "miembro", actorId, companyId, capacidades };
}

/**
 * El comando del personal que abre una empresa hasta la fase 5. El actor es
 * el sistema: el personal de la SOFIPO todavía no es una entidad.
 */
export function contextoDeSistema(): ContextoInvitacion {
  return {
    tipoActor: "sistema",
    actorId: null,
    companyId: null,
    capacidades: new Set(["invitar_empresa"]),
  };
}
