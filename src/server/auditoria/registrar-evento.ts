import "server-only";

export type EventoDeAuditoria = {
  empresaId: string | null;
  actorId: string | null;
  accion: "alta_empresa";
  entidad: "companies";
  entidadId: string | null;
};

/**
 * Hueco. La auditoría solo se inserta. Este módulo todavía no escribe
 * y nadie debe llamarlo hasta que el alta persista en `companies`.
 * El cuerpo no lleva secretos.
 */
export function registrarEvento(evento: EventoDeAuditoria): Promise<void> {
  void evento;
  return Promise.reject(new Error("auditoria_no_implementada"));
}
