import { Aviso } from "@/components/sistema";

const ID_AVISO = "aviso-operacion";

const MENSAJES: Record<string, string> = {
  prospecto_registrado: "Prospecto registrado. Ya puedes solicitar su activación.",
  activacion_solicitada: "Activación solicitada. La decide otra persona en Aprobaciones.",
  decision_registrada: "Decisión registrada en la bitácora.",
  invitacion_omitida_desarrollo: "Invitación emitida. En este entorno el correo no sale; el enlace anterior ya no sirve.",
  invitacion_enviada: "Invitación enviada. El enlace anterior ya no sirve.",
  invitacion_fallida: "La invitación quedó emitida, pero el correo no salió. Puedes reenviarla.",
  alerta_creada: "Alerta creada con su responsable.",
  alerta_asignada: "Responsable actualizado.",
  alerta_cerrada: "Alerta cerrada con su motivo.",
  comision_solicitada: "Versión propuesta. La autoriza otra persona en Aprobaciones.",
  misma_persona_en_activacion: "Quien pidió la activación no puede decidirla.",
  misma_persona_en_comision: "Quien propuso la comisión no puede decidirla.",
  reautenticacion_requerida: "Para decidir, tu segundo factor debe ser de los últimos 30 minutos. Sal y vuelve a entrar.",
  vigencia_solapada: "La nueva vigencia debe empezar después de la versión vigente.",
  vigencia_en_pasado: "La vigencia no puede empezar en el pasado.",
  comision_valor_invalido: "Escribe un número entero: puntos base para fondeo o centavos para SPEI.",
  cliente_no_activo: "Primero activa la empresa para el portal.",
  administrador_existente: "La empresa ya tiene un administrador activo.",
  alerta_ya_cerrada: "La alerta ya estaba cerrada.",
  solicitud_ya_decidida: "Esa solicitud ya se decidió.",
  comision_ya_decidida: "Esa versión ya se decidió.",
  rfc_duplicado: "Ese RFC ya está registrado.",
  correo_duplicado: "Ese correo ya pertenece a otra cuenta.",
  correo_ya_entra: "Esa persona ya es parte de la empresa.",
  motivo_invalido: "Escribe un motivo breve y claro.",
  activacion_transicion_invalida: "La empresa cambió de estado. Revisa la ficha antes de seguir.",
  recuperacion_ausente: "Esa solicitud ya no está pendiente.",
  misma_persona_en_recuperacion: "Quien pidió la recuperación no puede decidirla.",
  verificacion_invalida: "Di cómo verificaste la identidad.",
  sin_permiso: "Tu sesión no puede resolver recuperaciones. Entra por la puerta de Operación.",
  reautenticacion_factor: "Confirma que eres tú con tu segundo factor antes de decidir. Vale cinco minutos.",
};

/** El campo que causó cada error: el aviso se liga a ese campo con aria-describedby. */
const CAMPO: Record<string, string> = {
  rfc_duplicado: "rfc",
  correo_duplicado: "correo",
  correo_ya_entra: "correo",
  vigencia_solapada: "vigenteDesde",
  vigencia_en_pasado: "vigenteDesde",
  motivo_invalido: "motivo",
  verificacion_invalida: "verificacion",
};

/** Los avisos de algo que sí quedó hecho. Cualquier otro código (un rechazo o algo por revisar) se anuncia como alerta. */
const ASENTADOS: ReadonlySet<string> = new Set([
  "prospecto_registrado",
  "activacion_solicitada",
  "decision_registrada",
  "invitacion_omitida_desarrollo",
  "invitacion_enviada",
  "alerta_creada",
  "alerta_asignada",
  "alerta_cerrada",
  "comision_solicitada",
]);

export function tonoDelAviso(codigo: string): "asentado" | "revisar" {
  return ASENTADOS.has(codigo) ? "asentado" : "revisar";
}

export function AvisoOperacion({ codigo }: { codigo?: string }) {
  if (!codigo) return null;
  const mensaje = MENSAJES[codigo] ?? "No se pudo completar. Revisa los datos e inténtalo de nuevo.";
  return (
    <div id={ID_AVISO} className="operacion-aviso">
      <Aviso tono={tonoDelAviso(codigo)} titulo={mensaje} />
    </div>
  );
}

/** Marca un campo como inválido y lo liga al aviso cuando el error de la página es suyo. */
export function errorDelCampo(codigo: string | undefined, campo: string) {
  if (!codigo || CAMPO[codigo] !== campo) return {};
  return { "aria-invalid": true, "aria-describedby": ID_AVISO } as const;
}
