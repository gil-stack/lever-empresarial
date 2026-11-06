const MENSAJES: Record<string, string> = {
  prospecto_registrado: "Prospecto registrado. Ya puedes solicitar su activación.",
  activacion_solicitada: "Solicitud registrada. Otra persona debe aprobarla.",
  decision_registrada: "Decisión registrada con su auditoría.",
  invitacion_omitida_desarrollo: "Invitación emitida. El correo está deshabilitado en desarrollo; el enlace anterior quedó invalidado.",
  invitacion_enviada: "Invitación enviada. El enlace anterior quedó invalidado.",
  invitacion_fallida: "Invitación emitida, pero el correo falló. Puedes reenviarla.",
  alerta_creada: "Alerta creada con responsable.",
  alerta_asignada: "Responsable actualizado.",
  alerta_cerrada: "Alerta cerrada con su motivo.",
  comision_solicitada: "Versión propuesta. Otra persona debe autorizarla; no se generó ningún cargo.",
  misma_persona_en_activacion: "Quien solicitó la activación no puede aprobarla.",
  misma_persona_en_comision: "Quien propuso la comisión no puede autorizarla.",
  reautenticacion_requerida: "La autorización exige un segundo factor reciente. Sal y vuelve a entrar por la puerta de operación.",
  vigencia_solapada: "La nueva vigencia debe empezar después de la versión vigente.",
  vigencia_en_pasado: "La vigencia no puede empezar en el pasado.",
  comision_valor_invalido: "Escribe un entero: basis points para fondeo o centavos para SPEI.",
  cliente_no_activo: "Primero activa la empresa para el portal.",
  administrador_existente: "La empresa ya tiene un administrador activo.",
  alerta_ya_cerrada: "La alerta ya estaba cerrada.",
  solicitud_ya_decidida: "La solicitud ya fue decidida.",
  comision_ya_decidida: "La versión ya fue decidida.",
  rfc_duplicado: "Ese RFC ya está registrado.",
  correo_duplicado: "Ese correo ya pertenece a otra cuenta.",
  correo_ya_entra: "Esa persona ya tiene membresía en la empresa.",
  motivo_invalido: "Escribe un motivo breve y claro.",
  activacion_transicion_invalida: "La empresa cambió de estado. Revisa la ficha antes de continuar.",
  recuperacion_ausente: "Esa solicitud ya no está pendiente.",
  misma_persona_en_recuperacion: "Quien pidió la recuperación no puede aprobarla.",
  verificacion_invalida: "Di cómo verificaste la identidad.",
  sin_permiso: "Tu sesión no puede resolver recuperaciones. Entra por la puerta de operación.",
  reautenticacion_factor: "Confirma que eres tú con tu segundo factor antes de decidir. Vale cinco minutos.",
};

export function AvisoOperacion({ codigo }: { codigo?: string }) {
  if (!codigo) return null;
  const mensaje = MENSAJES[codigo] ?? "No se pudo completar. Revisa los datos e inténtalo de nuevo.";
  const exito = /registrad|solicitad|enviada|creada|asignada|cerrada|omitida/.test(codigo);
  return <div className={`alerta ${exito ? "alerta-asentado" : ""}`} role={exito ? "status" : "alert"}><p>{mensaje}</p></div>;
}
