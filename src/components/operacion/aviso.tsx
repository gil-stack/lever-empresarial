import { Aviso } from "@/components/sistema";

const ID_AVISO = "aviso-operacion";

const MENSAJES: Record<string, string> = {
  prospecto_registrado: "Prospecto registrado. Ya puedes solicitar su activación.",
  activacion_solicitada: "Activación solicitada. La decide otra persona en Aprobaciones.",
  decision_registrada: "Decisión registrada en la bitácora.",
  invitacion_omitida_desarrollo: "Invitación emitida. En este entorno el correo no sale; el enlace anterior ya no sirve.",
  invitacion_enviada: "Invitación enviada. El enlace anterior ya no sirve.",
  invitacion_fallida: "La invitación quedó emitida, pero el correo no salió. Puedes reenviarla.",
  invitacion_ya_enviada: "Ya se había enviado una invitación más reciente. El enlace vigente es el de ese último correo.",
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
  // Ola R1: alta regulada.
  sin_permiso_operacion: "Tu rol no puede hacer esto. Pídeselo a quien tenga el rol indicado.",
  rol_asignado: "Rol asignado. Quedó en la bitácora.",
  rol_retirado: "Rol retirado. Quedó en la bitácora.",
  rol_propio: "Nadie se asigna ni se quita roles a sí mismo. Pídeselo a otra persona de Administración.",
  roles_incompatibles: "Cumplimiento no se junta con Auditoría ni con Originación (50ª de las disposiciones).",
  sin_permiso_roles: "Solo Administración de la plataforma asigna roles.",
  rol_invalido: "Elige un rol de la lista.",
  persona_ausente: "Esa persona ya no está en el personal.",
  expediente_version_creada: "Borrador abierto. Captura los datos, los documentos y la estructura accionaria.",
  expediente_datos_guardados: "Datos generales guardados en el borrador.",
  expediente_representante_agregado: "Representante agregado al borrador.",
  expediente_accionista_agregado: "Accionista agregado al borrador.",
  expediente_retirado: "Quitado del borrador. Las versiones enviadas no cambian.",
  expediente_documento_cargado: "Documento guardado con su huella SHA-256.",
  expediente_enviado: "Versión enviada. La dictamina Cumplimiento, una persona distinta a quien la armó.",
  expediente_dictaminado: "Dictamen registrado sobre esa versión.",
  riesgo_calificado: "Grado de riesgo registrado con su fecha de revisión.",
  expediente_ausente: "Ese expediente ya no está disponible. Vuelve a abrirlo.",
  expediente_con_borrador: "Ya hay un borrador abierto. Termínalo o envíalo antes de abrir otro.",
  expediente_en_revision: "Hay una versión enviada sin dictamen. Espera el dictamen antes de abrir otra.",
  expediente_enviado_inmutable: "Esa versión ya se envió y no cambia. Abre una versión nueva.",
  expediente_rfc_distinto: "El RFC del expediente debe ser el mismo de la empresa.",
  expediente_sin_representante: "Falta al menos un representante.",
  expediente_sin_administrador: "Falta quien administra la empresa (administrador único o consejo).",
  expediente_falta_documento: "Falta un documento obligatorio o la identificación de un representante.",
  expediente_documento_vencido: "Hay un documento vencido. Carga uno vigente antes de enviar.",
  expediente_estructura_incompleta: "La estructura accionaria no suma 100 % o una persona moral no está desglosada hasta personas físicas.",
  documento_fecha_futura: "La fecha de emisión no puede ser futura.",
  documento_sin_representante: "La identificación va ligada a un representante: elígelo.",
  documento_no_existe: "Ese documento no existe o no es de tu operador.",
  accionista_padre_invalido: "El socio del que depende debe ser una persona moral de este borrador.",
  accionista_con_desglose: "Ese socio tiene accionistas debajo: quítalos primero.",
  archivo_no_disponible: "No se pudo guardar o leer el archivo. Inténtalo de nuevo.",
  archivo_no_admitido: "Sube un PDF, PNG o JPG legible.",
  archivo_demasiado_grande: "El archivo pasa de 10 MB.",
  misma_persona_en_dictamen: "Quien armó o envió la versión no puede dictaminarla.",
  dictamen_sobre_borrador: "Solo se dictamina una versión enviada.",
  dictamen_ya_registrado: "Esa versión ya tiene dictamen.",
  sin_rol_para_dictaminar: "Solo Cumplimiento dictamina.",
  sin_rol_para_expediente: "Tu rol no captura expedientes. Lo hace Originación.",
  sin_rol_para_calificar: "Solo Cumplimiento califica el riesgo.",
  calificacion_sin_expediente: "Primero aprueba una versión del expediente.",
  calificacion_sobre_version_vieja: "Califica sobre la versión vigente del expediente.",
  riesgo_debe_ser_alto: "Con una persona expuesta políticamente extranjera o una coincidencia exacta, el grado es alto.",
  lpb_cargada: "Lista cargada. La base ya cotejó a todas las empresas, sus representantes, propietarios reales y proveedores.",
  lpb_vacia: "El archivo no trae renglones.",
  lpb_encabezado_invalido: "El encabezado debe ser exactamente: nombre,rfc,curp,tipo,fecha.",
  lpb_renglon_invalido: "Hay un renglón mal formado.",
  lpb_demasiado_grande: "La lista pasa del tope de 50 000 renglones o 6 MB.",
  lpb_ya_cargada: "Esa misma lista ya se había cargado.",
  sin_rol_para_lpb: "Solo Cumplimiento carga la lista y resuelve coincidencias.",
  coincidencia_resuelta: "Coincidencia resuelta con su motivo.",
  coincidencia_ausente: "Esa coincidencia ya no está pendiente.",
  coincidencia_transicion_invalida: "Esa coincidencia ya se resolvió de otra forma.",
  coincidencia_sigue_en_lista: "La persona sigue en la lista vigente: no puede marcarse «fuera de la lista».",
  reporte_registrado: "Folio del reporte anotado. Lever no envía reportes a la UIF.",
  reporte_sin_confirmar: "Primero confirma la coincidencia.",
  reporte_ya_registrado: "Esa coincidencia ya tiene folio de reporte.",
  reporte_fecha_futura: "Las fechas del reporte y del aviso no pueden ser futuras.",
  suspension_solicitada: "Suspensión pedida. La aprueba otra persona con rol de Aprobación.",
  reactivacion_solicitada: "Reactivación pedida. La aprueba otra persona con rol de Aprobación.",
  suspension_pendiente: "Ya hay una solicitud de suspensión o reactivación pendiente para esta empresa.",
  suspension_no_aplica: "La empresa no está activa: no hay nada que suspender.",
  reactivacion_no_aplica: "La empresa no está suspendida.",
  reactivacion_con_coincidencia_lpb: "La suspensión vino de la Lista de Personas Bloqueadas: primero Cumplimiento debe dictaminar «falso positivo».",
  misma_persona_en_suspension: "Quien pidió la suspensión o la reactivación no puede decidirla.",
  suspension_transicion_invalida: "Esa solicitud ya se decidió.",
  sin_rol_para_suspender: "Pedir una suspensión es de Originación o Cumplimiento.",
  sin_rol_para_aprobar: "Solo Aprobación decide.",
  activacion_sin_expediente_aprobado: "La base no deja activar: falta un expediente aprobado en su versión vigente.",
  activacion_con_documento_vencido: "La base no deja activar: hay un documento vencido en el expediente.",
  activacion_con_coincidencia_lpb: "La base no deja activar: hay una coincidencia con la Lista de Personas Bloqueadas sin resolver.",
  activacion_sin_riesgo_vigente: "La base no deja activar: falta un grado de riesgo vigente.",
  activacion_sin_estructura_corporativa: "La base no deja activar: falta desglosar la estructura accionaria hasta personas físicas.",
  sin_rol_para_solicitar_activacion: "Pedir la activación es de Originación.",
  sin_rol_para_registrar: "Registrar prospectos es de Originación.",
  empresa_suspendida: "La empresa está suspendida: no se puede mover dinero ni cambiar nada hasta que se reactive.",
  cliente_de_baja: "La empresa está dada de baja.",
  formulario_invalido: "El formulario caducó. Recarga la página.",
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
  lpb_vacia: "archivo",
  lpb_encabezado_invalido: "archivo",
  lpb_renglon_invalido: "archivo",
  lpb_demasiado_grande: "archivo",
  lpb_ya_cargada: "archivo",
  archivo_no_admitido: "archivo",
  archivo_demasiado_grande: "archivo",
  archivo_no_disponible: "archivo",
  documento_fecha_futura: "emitidoEl",
  documento_sin_representante: "representanteClave",
  accionista_padre_invalido: "padreClave",
  expediente_rfc_distinto: "rfc",
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
  "rol_asignado",
  "rol_retirado",
  "expediente_version_creada",
  "expediente_datos_guardados",
  "expediente_representante_agregado",
  "expediente_accionista_agregado",
  "expediente_retirado",
  "expediente_documento_cargado",
  "expediente_enviado",
  "expediente_dictaminado",
  "riesgo_calificado",
  "lpb_cargada",
  "coincidencia_resuelta",
  "reporte_registrado",
  "suspension_solicitada",
  "reactivacion_solicitada",
]);

export function tonoDelAviso(codigo: string): "asentado" | "revisar" {
  return ASENTADOS.has(codigo) ? "asentado" : "revisar";
}

export function AvisoOperacion({ codigo, detalle }: { codigo?: string; detalle?: string }) {
  if (!codigo) return null;
  const mensaje =
    MENSAJES[codigo] ??
    (codigo.startsWith("dato_invalido_") ? "Revisa el campo marcado: el dato no tiene el formato esperado." : null) ??
    "No se pudo completar. Revisa los datos e inténtalo de nuevo.";
  return (
    <div id={ID_AVISO} className="operacion-aviso">
      <Aviso tono={tonoDelAviso(codigo)} titulo={mensaje}>
        {detalle ? <p>{detalle}</p> : null}
      </Aviso>
    </div>
  );
}

/** Marca un campo como inválido y lo liga al aviso cuando el error de la página es suyo. `dato_invalido_<campo>` es de ese campo. */
export function errorDelCampo(codigo: string | undefined, campo: string) {
  if (!codigo || (CAMPO[codigo] ?? codigo.replace(/^dato_invalido_/, "")) !== campo) return {};
  return { "aria-invalid": true, "aria-describedby": ID_AVISO } as const;
}
