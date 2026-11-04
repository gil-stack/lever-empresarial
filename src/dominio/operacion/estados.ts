export type EstadoCliente = "prospecto" | "en_alta" | "activa" | "suspendida" | "baja";

export function transicionDeActivacion(actual: EstadoCliente, decision: "solicitar" | "aprobar" | "rechazar"): EstadoCliente {
  if (decision === "solicitar" && actual === "prospecto") return "en_alta";
  if (decision === "aprobar" && actual === "en_alta") return "activa";
  if (decision === "rechazar" && actual === "en_alta") return "prospecto";
  throw new Error("activacion_transicion_invalida");
}

export function exigirOtraPersona(solicitante: string, aprobador: string): void {
  if (solicitante === aprobador) throw new Error("misma_persona_en_autorizacion");
}
