import { Aviso } from "@/components/sistema";
import { TOPE_ARCHIVO_TEXTO } from "@/dominio/archivos";
import { deCatalogo } from "@/dominio/catalogo";

import { MensajeJuntoAlCampo } from "./mensaje-junto-al-campo";
import { ASENTADOS_PLD, CAMPO_PLD, CAMPOS_CON_AVISO_PLD, MENSAJES_PLD } from "./pld/avisos";

const ID_AVISO = "aviso-operacion";
/** El aviso de un rechazo cuyo formulario ya no se pinta (`AvisoSinFormulario`): sin campo al lado, siempre se anuncia. */
export const ID_AVISO_RECHAZO = "aviso-rechazo";

/** El mismo texto lo muestra el navegador antes de enviar (CampoArchivo) y la pantalla si lo rechaza el servidor. */
export const ARCHIVO_DEMASIADO_GRANDE = `El archivo pasa de ${TOPE_ARCHIVO_TEXTO}. Sube uno más ligero.`;
export const LISTA_DEMASIADO_GRANDE = `La lista pasa del tope de 50 000 renglones o ${TOPE_ARCHIVO_TEXTO}.`;

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
  plan_actualizado: "Plan guardado. El cobro del mes ya usa los montos nuevos.",
  plan_asignado: "Plan asignado al cliente.",
  plan_ausente: "Ese plan ya no existe. Recarga la página.",
  plan_nombre_invalido: "Escribe el nombre del plan, de 1 a 60 caracteres.",
  plan_mensualidad_invalida: "Escribe la mensualidad en pesos, como 1500 o 1,500.00.",
  plan_spei_invalido: "Escribe el costo por SPEI en pesos, como 8 o 8.50 (hasta $100,000.00).",
  cliente_en_baja: "Ese cliente está dado de baja; no se le asigna plan.",
  misma_persona_en_activacion: "Quien pidió la activación no puede decidirla.",
  misma_persona_en_comision: "Quien propuso la comisión no puede decidirla.",
  reautenticacion_requerida: "Para decidir, tu segundo factor debe ser de los últimos 30 minutos. Sal y vuelve a entrar.",
  vigencia_solapada: "La nueva vigencia debe empezar después de la versión vigente.",
  vigencia_en_pasado: "La vigencia no puede empezar en el pasado.",
  comision_valor_invalido: "Escribe un número entero: puntos base para fondeo o centavos para SPEI.",
  comision_tipo_invalido: "Elige el tipo: fondeo o SPEI.",
  comision_pendiente: "Ya hay una versión pendiente de esta comisión para la empresa. Espera a que se decida antes de pedir otra.",
  vigencia_invalida: "Escribe una fecha que exista en el calendario.",
  cliente_no_activo: "Primero activa la empresa para el portal.",
  administrador_existente: "La empresa ya tiene un administrador activo.",
  alerta_ya_cerrada: "La alerta ya estaba cerrada.",
  responsable_invalido: "Elige a una persona activa del personal.",
  // Alta del prospecto: cada rechazo dice qué falla y marca su campo.
  rfc_invalido: "Ese RFC no tiene la forma de un RFC: 12 caracteres si es persona moral o 13 si es física.",
  dato_invalido_correo: "Escribe un correo válido, como nombre@empresa.mx.",
  rfc_generico: "Ese es un RFC genérico (público en general o extranjero). Escribe el RFC de la empresa.",
  razon_social_invalida: "Escribe la razón social con letras o números, hasta 254 caracteres.",
  razon_social_control: "La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano.",
  codigo_postal_invalido: "Ese código postal no existe. Escribe los 5 dígitos del domicilio fiscal.",
  regimen_invalido: "Ese régimen fiscal no corresponde al tipo de persona del RFC.",
  uso_cfdi_invalido: "Ese uso de CFDI no corresponde al régimen ni al tipo de persona.",
  solicitud_ya_decidida: "Esa solicitud ya se decidió.",
  comision_ya_decidida: "Esa versión ya se decidió.",
  rfc_duplicado: "Ese RFC ya está registrado.",
  correo_duplicado: "Ese correo ya pertenece a otra cuenta.",
  correo_ya_entra: "Esa persona ya es parte de la empresa.",
  motivo_invalido: "Escribe un motivo breve y claro.",
  motivo_corto: "El motivo lleva al menos 10 caracteres: explica por qué en una frase. Queda en la bitácora y lo lee otra persona.",
  motivo_largo: "El motivo pasa de 500 caracteres. Resúmelo: queda en la bitácora y lo lee otra persona.",
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
  expediente_datos_incompletos: "Faltan datos generales para enviar la versión. Revisa «Datos generales».",
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
  archivo_demasiado_grande: ARCHIVO_DEMASIADO_GRANDE,
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
  lpb_demasiado_grande: LISTA_DEMASIADO_GRANDE,
  lpb_ya_cargada: "Esa misma lista ya se había cargado.",
  sin_rol_para_lpb: "Solo Cumplimiento carga la lista y resuelve coincidencias.",
  coincidencia_resuelta: "Coincidencia resuelta con su motivo.",
  coincidencia_ausente: "Esa coincidencia ya no está pendiente.",
  coincidencia_transicion_invalida: "Esa coincidencia ya se resolvió de otra forma.",
  coincidencia_ya_resuelta: "Esa coincidencia ya se resolvió. Tu dictamen y tu motivo no se guardaron.",
  coincidencia_sigue_en_lista: "La persona sigue en la lista vigente: no puede marcarse «fuera de la lista».",
  reporte_registrado: "Folio del reporte anotado. Lever no envía reportes a la UIF.",
  reporte_sin_confirmar: "Primero confirma la coincidencia.",
  reporte_ya_registrado: "Esa coincidencia ya tiene folio de reporte.",
  reporte_fecha_futura: "Las fechas del reporte y del aviso no pueden ser futuras.",
  dato_invalido_presentadoEl: "Revisa la fecha de presentación del reporte: debe existir en el calendario y no puede ser futura.",
  dato_invalido_avisoClienteEl: "Revisa la fecha del aviso al cliente: debe existir en el calendario y no puede ser futura. Déjala vacía si aún no avisas.",
  suspension_solicitada: "Suspensión pedida. La aprueba otra persona con rol de Aprobación.",
  reactivacion_solicitada: "Reactivación pedida. La aprueba otra persona con rol de Aprobación.",
  suspension_pendiente: "Ya hay una solicitud de suspensión o reactivación pendiente para esta empresa.",
  suspension_no_aplica: "La empresa no está activa: no hay nada que suspender.",
  reactivacion_no_aplica: "La empresa no está suspendida.",
  // Originación y Aprobación también ven estos dos: no nombran la lista (55ª).
  reactivacion_con_coincidencia_lpb: "Cumplimiento tiene un caso abierto de esta empresa: no se puede reactivar hasta que lo resuelva.",
  misma_persona_en_suspension: "Quien pidió la suspensión o la reactivación no puede decidirla.",
  suspension_transicion_invalida: "Esa solicitud ya se decidió.",
  sin_rol_para_suspender: "Pedir una suspensión es de Originación o Cumplimiento.",
  sin_rol_para_aprobar: "Solo Aprobación decide.",
  activacion_sin_expediente_aprobado: "La base no deja activar: falta un expediente aprobado en su versión vigente.",
  activacion_con_documento_vencido: "La base no deja activar: hay un documento vencido en el expediente.",
  activacion_con_coincidencia_lpb: "Cumplimiento tiene un caso abierto de esta empresa: no se puede activar hasta que lo resuelva.",
  activacion_sin_riesgo_vigente: "La base no deja activar: falta un grado de riesgo vigente.",
  activacion_sin_estructura_corporativa: "La base no deja activar: falta desglosar la estructura accionaria hasta personas físicas.",
  activacion_sin_perfil_transaccional:
    "La base no deja activar: falta el perfil transaccional declarado (montos y número de operaciones estimados al mes).",
  sin_rol_para_solicitar_activacion: "Pedir la activación es de Originación.",
  sin_rol_para_registrar: "Registrar prospectos es de Originación.",
  empresa_suspendida: "La empresa está suspendida: no se puede mover dinero ni cambiar nada hasta que se reactive.",
  empresa_no_activa_efevoo: "La empresa debe estar activa para operar con Efevoo en producción.",
  cliente_de_baja: "La empresa está dada de baja.",
  formulario_invalido: "El formulario caducó. Recarga la página.",
  // Revisión del PR #59.
  base_no_disponible: "La base no respondió. No se aplicó ningún cambio; vuelve a intentar.",
  auditoria_no_disponible: "No se pudo dejar el registro en la bitácora, así que el cambio no se aplicó.",
  empresa_nace_prospecto: "Desde Operación una empresa nace como prospecto y se activa con su expediente.",
  sin_rol_de_administracion: "Solo Administración de la plataforma hace esto.",
  personal_propio: "Nadie cambia su propio registro del personal. Pídeselo a otra persona de Administración.",
  personal_no_se_reescribe: "El registro del personal no cambia de persona, operador ni fecha de alta.",
  expediente_accionista_sin_curp: "Cada socio persona física mexicana lleva su CURP: con ella se suma lo que tiene por varios caminos.",
  expediente_accionista_sin_identificacion:
    "Cada socio extranjero lleva su país y el número de su pasaporte o identificación oficial con su fecha de nacimiento (persona física) o de su registro en su país (persona moral): con ellos se suma lo que tiene por varios caminos.",
  expediente_accionista_sin_rfc: "Cada socio persona moral mexicana lleva su RFC.",
  expediente_misma_persona_dos_identificadores:
    "Hay dos socios con el mismo nombre y la misma fecha de nacimiento capturados con identificadores distintos (CURP, pasaporte o identificación). Si es la misma persona, quita uno y captúralo con el mismo identificador en cada lugar donde aparece.",
  dato_invalido_pais: "Elige el país de la persona extranjera. Si es mexicana, elige «Mexicana» en la nacionalidad.",
  dato_invalido_documentoExtranjero:
    "Escribe el número de identificación: de 4 a 20 letras y números (los espacios, puntos y guiones se quitan solos).",
  dato_invalido_fechaNacimiento: "Escribe la fecha de nacimiento: no puede ser futura ni anterior a 1900.",
  // Una identidad con un carácter invisible (`INVISIBLE`): se ve bien en pantalla, así que el aviso dice qué pasó.
  invisible_nombre: "El nombre trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano.",
  invisible_razonSocial: "La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano.",
  invisible_folio: "El folio trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano.",
  expediente_estructura_muy_profunda: "La cadena de socios pasa de 10 capas: el cálculo de propietarios reales no llega al final. Revísala con Cumplimiento.",
  ...MENSAJES_PLD,
  // Tarjetas (Efevoo), 0033.
  efevoo_alta_confirmada: "Empresa dada de alta en Efevoo. Ya se pueden asignar tarjetas.",
  efevoo_deposito_confirmado: "Depósito de prueba aplicado al saldo de la empresa en Efevoo.",
  efevoo_tarjeta_activada: "Tarjeta asignada y activada en Efevoo.",
  efevoo_tarjeta_asignada_sin_activar: "La tarjeta quedó asignada, pero la activación no se completó. Retómala con «Activar» en la lista de tarjetas.",
  efevoo_tarjeta_cancelada: "Tarjeta cancelada en Efevoo. Es irreversible.",
  efevoo_reintento_confirmado: "Reintento confirmado en Efevoo, con una referencia nueva ligada a la anterior.",
  efevoo_conciliada: "La operación sí aparece en Efevoo: quedó confirmada.",
  efevoo_no_aparecio: "La operación no aparece en Efevoo después de 10 minutos: quedó fallida y ya se puede reintentar.",
  efevoo_espera: "Todavía no aparece en Efevoo. Vuelve a conciliar en unos minutos: antes de 10 minutos no se da por perdida.",
  efevoo_ambigua: "En Efevoo hay más de un movimiento que podría ser este, o uno que no se puede leer completo. Revísala con Efevoo antes de reintentar.",
  efevoo_ya_resuelta: "Esa operación ya estaba resuelta.",
  efevoo_ya_enviada: "Ese formulario ya se había enviado: se muestra la operación de esa vez, sin repetirla.",
  efevoo_fallida: "Efevoo rechazó la operación. El código quedó en la lista de operaciones.",
  efevoo_incierta: "Efevoo no respondió a tiempo: la operación quedó incierta. Concíliala antes de intentar otra vez.",
  efevoo_saldo_insuficiente: "No alcanza el saldo para esta operación. Efevoo no se llamó.",
  efevoo_no_configurado: "Efevoo no está configurado en este entorno.",
  efevoo_no_autorizado: "Efevoo rechazó las credenciales o el método. Avisa a Tecnología.",
  efevoo_rechazo: "Efevoo rechazó la consulta. Intenta de nuevo en unos minutos.",
  efevoo_incierto: "Efevoo no respondió. No se aplicó ningún cambio en Lever; intenta de nuevo en unos minutos.",
  solo_sandbox: "El dinero de prueba solo existe en el ambiente de pruebas de Efevoo.",
  expediente_sin_datos: "La empresa no tiene un expediente enviado con su razón social: complétalo antes de darla de alta en Efevoo.",
  expediente_sin_correo: "El expediente no tiene correo de la empresa: Efevoo lo pide para el alta.",
  plastico_no_disponible: "Ese plástico ya no está en el inventario de Efevoo. Elige otro.",
  correo_de_prueba: "En el ambiente de pruebas el correo del titular es de prueba: termina en @lever.test o @ejemplo.mx.",
  operacion_en_curso: "Esa tarjeta ya tiene una operación en curso. Espera a que se resuelva o concíliala.",
  tarjeta_en_cancelacion: "Esa tarjeta tiene una cancelación en curso.",
  empresa_ya_vinculada: "La empresa ya está dada de alta en Efevoo.",
  empresa_sin_vinculo: "Primero da de alta la empresa en Efevoo.",
  solo_empresas_reales: "Las empresas de demostración no van a Efevoo.",
  tarjeta_ya_asignada: "Ese plástico ya está asignado.",
  tarjeta_no_encontrada: "Esa tarjeta no está en la empresa.",
  tarjeta_en_otro_estado: "La tarjeta cambió de estado. Revisa la lista antes de seguir.",
  empleado_no_activo: "Elige a un empleado activo de la empresa.",
  intento_con_otros_datos: "Ese formulario ya se envió con otros datos. Recarga la página para empezar uno nuevo.",
  sin_permiso_para_efevoo: "Solo Administración de la plataforma opera Efevoo desde aquí.",
  conciliacion_prematura: "Todavía no pasan 10 minutos desde la operación: Efevoo podría estar procesándola.",
  reintento_no_valido: "Esa operación no se puede reintentar desde aquí.",
  reintento_ya_hecho: "Esa operación ya se reintentó.",
  operacion_no_encontrada: "Esa operación no está en la empresa.",
  transicion_no_valida: "La operación ya cambió de estado. Revisa la lista.",
  entrada_invalida: "El formulario caducó. Recarga la página.",
  dato_invalido_monto: "Escribe un monto en pesos, de $0.01 a $100,000.00.",
  dato_invalido_ultimos8: "Escribe los últimos 8 dígitos del plástico, tal como vienen impresos; deben terminar en la terminación del plástico elegido.",
  dato_invalido_nombreEmbozar: "Escribe el nombre a embozar en mayúsculas, sin acentos raros, de 2 a 26 caracteres.",
  dato_invalido_telefono: "Escribe el teléfono a 10 dígitos, sin espacios.",
  dato_invalido_confirmacion: "Escribe la terminación de la tarjeta para confirmar la cancelación.",
  dato_invalido_employeeId: "Elige al empleado.",
  dato_invalido_inventarioId: "Elige un plástico del inventario.",
  efevoo_cierre_manual: "Operación cerrada a mano con su motivo. Su resultado en Efevoo queda desconocido y no se puede reintentar.",
  empleado_con_tarjeta_por_activar: "Esa persona tiene una tarjeta asignada sin activar. Actívala antes de asignarle otra.",
  cierre_manual_no_valido: "Solo se cierra a mano una operación abierta de una tarjeta cancelada, 10 minutos después de pedirla.",
};

/** El campo que causó cada error: el aviso se liga a ese campo con aria-describedby. */
const CAMPO: Record<string, string> = {
  plan_nombre_invalido: "nombre",
  plan_mensualidad_invalida: "mensualidad",
  plan_spei_invalido: "spei",
  cliente_en_baja: "companyId",
  comision_valor_invalido: "valor",
  comision_tipo_invalido: "tipo",
  comision_pendiente: "tipo",
  vigencia_invalida: "vigenteDesde",
  responsable_invalido: "responsableId",
  rfc_duplicado: "rfc",
  correo_duplicado: "correo",
  correo_ya_entra: "correo",
  vigencia_solapada: "vigenteDesde",
  vigencia_en_pasado: "vigenteDesde",
  motivo_invalido: "motivo",
  motivo_corto: "motivo",
  motivo_largo: "motivo",
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
  rfc_invalido: "rfc",
  rfc_generico: "rfc",
  razon_social_invalida: "razonSocial",
  razon_social_control: "razonSocial",
  codigo_postal_invalido: "codigoPostal",
  regimen_invalido: "regimen",
  uso_cfdi_invalido: "usoCfdi",
  correo_de_prueba: "correo",
  plastico_no_disponible: "inventarioId",
  tarjeta_ya_asignada: "inventarioId",
  empleado_no_activo: "employeeId",
  empleado_con_tarjeta_por_activar: "employeeId",
  ...CAMPO_PLD,
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
  "plan_actualizado",
  "plan_asignado",
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
  "efevoo_alta_confirmada",
  "efevoo_deposito_confirmado",
  "efevoo_tarjeta_activada",
  "efevoo_tarjeta_cancelada",
  "efevoo_reintento_confirmado",
  "efevoo_conciliada",
  ...ASENTADOS_PLD,
]);

export function tonoDelAviso(codigo: string): "asentado" | "revisar" {
  return ASENTADOS.has(codigo) ? "asentado" : "revisar";
}

/** El texto de un aviso: el mismo arriba (el resumen) y junto al campo. */
/**
 * Los campos que nombran `dato_invalido_<campo>` e `invisible_<campo>`: la lista cerrada de lo que lanzan las acciones
 * de Operación (los datos generales del borrador, más los de cada formulario). aviso.test.ts la compara con el código.
 */
const CAMPOS_CON_AVISO = new Set([
  // Datos generales del borrador (CAMPOS_DATOS de src/server/operacion/expediente.ts).
  "razonSocial", "giro", "nacionalidad", "rfc", "serieEfirma", "domicilioCalle", "domicilioExterior", "domicilioInterior",
  "domicilioColonia", "domicilioMunicipio", "domicilioEntidad", "domicilioCodigoPostal", "domicilioPais", "telefono", "correo",
  "fechaConstitucion", "volumenMensualCentavos",
  // Los demás formularios.
  "actividad", "archivo", "avisoClienteEl", "capital", "cargo", "curp", "designadoPor", "detalle", "documentoExtranjero",
  "emitidoEl", "estado", "fechaNacimiento", "folio", "nombre", "padreClave", "pais", "pep", "presentadoEl",
  "representanteClave", "resultado", "tipo", "tipoPersona", "titulo", "vigenteHasta", "votos", "zona",
  // Tarjetas (Efevoo).
  "monto", "employeeId", "inventarioId", "ultimos8", "primerApellido", "segundoApellido", "nombreEmbozar", "paisNacimiento",
  "domicilio", "confirmacion",
  ...CAMPOS_CON_AVISO_PLD,
]);

/**
 * Si el código es del catálogo: un mensaje propio, o el dato inválido o invisible de un campo de la lista cerrada.
 * La cookie del rechazo solo vale si lo es, y `data-aviso` solo copia un código del catálogo.
 */
export function avisoConocido(codigo: string): boolean {
  if (Object.hasOwn(MENSAJES, codigo)) return true;
  const campo = /^(?:dato_invalido|invisible)_(.+)$/.exec(codigo)?.[1];
  return campo !== undefined && CAMPOS_CON_AVISO.has(campo);
}

/**
 * Lo que se pinta de un código de la dirección: el del catálogo; uno con forma de código que no está en el catálogo da el
 * mensaje general (la red si falta un mensaje); un campo fuera de la lista cerrada o algo sin forma de código, nada.
 */
function avisoPintable(codigo: string): boolean {
  if (avisoConocido(codigo)) return true;
  if (/^(?:dato_invalido|invisible)_/.test(codigo)) return false;
  return codigo.length <= 80 && /^[a-z][a-z0-9]*(?:_[a-zA-Z0-9]+)*$/.test(codigo);
}

export function textoDelAviso(codigo: string): string {
  return (
    deCatalogo(MENSAJES, codigo) ??
    (codigo.startsWith("dato_invalido_") ? "Revisa el campo marcado: el dato no tiene el formato esperado." : null) ??
    "No se pudo completar. Revisa los datos e inténtalo de nuevo."
  );
}

/**
 * `id` es para el formulario que muestra su propio aviso sin recargar la página (y no repite el de la página). En ese
 * formulario, el aviso de un campo es solo el resumen: el campo con el foco lo lee como su descripción, así que el
 * resumen no es región viva (el lector no lo dice dos veces). El aviso de la página y los que no son de un campo sí lo son.
 */
export function AvisoOperacion({ codigo, detalle, id = ID_AVISO }: { codigo?: string | null; detalle?: string; id?: string }) {
  if (!codigo || !avisoPintable(codigo)) return null;
  const mensaje = textoDelAviso(codigo);
  return (
    // `data-aviso`: el código, como el de la dirección (?aviso=), para el recorrido de evidencia y el soporte. Uno que no
    // es del catálogo no se copia a la página.
    <div id={id} className="operacion-aviso" data-aviso={avisoConocido(codigo) ? codigo : "desconocido"}>
      {/* El destino del fragmento de la vuelta sin JavaScript (`permalinkDelRechazo`) cuando el error no es de un campo. */}
      {id !== ID_AVISO && id !== ID_AVISO_RECHAZO && !avisoDeCampo(codigo) ? <span id={`${id}-campo`} className="destino-del-rechazo" /> : null}
      <Aviso tono={tonoDelAviso(codigo)} titulo={mensaje} anunciar={id === ID_AVISO || id === ID_AVISO_RECHAZO || !avisoDeCampo(codigo)}>
        {detalle ? <p>{detalle}</p> : null}
      </Aviso>
    </div>
  );
}

/**
 * Si el error es de un campo: `errorDelCampo` lo marca, el formulario le da el foco con JavaScript, y el resumen de su
 * formulario se pinta sin región viva (el campo con el foco ya lo anuncia).
 */
export function avisoDeCampo(codigo: string): boolean {
  return Object.hasOwn(CAMPO, codigo) || /^(dato_invalido|invisible)_/.test(codigo);
}

/**
 * Marca un campo como inválido y lo liga a su mensaje (`MensajeDelCampo`) cuando el error es suyo. `dato_invalido_<campo>`
 * e `invisible_<campo>` son de ese campo. Un formulario que muestra su propio aviso (sin recargar la página) pasa
 * el id de ese aviso. Sin `autofocus`: con JavaScript el formulario le da el foco al campo marcado (useFormularioConAviso
 * y useConservaLoCapturado); sin JavaScript la respuesta llega al mensaje por su fragmento (`permalinkDelRechazo`).
 */
export function errorDelCampo(codigo: string | null | undefined, campo: string, idAviso = ID_AVISO) {
  if (!esDelCampo(codigo, campo)) return {};
  return { "aria-invalid": true, "aria-describedby": `${idAviso}-campo` } as const;
}

/**
 * El `permalink` de `useActionState` de un formulario de Operación: sin JavaScript, el envío va a la misma dirección con
 * el fragmento del mensaje del error (`#<idAviso>-campo`, o el destino del aviso si el error no es de un campo). El
 * navegador alinea ese destino arriba respetando su `scroll-margin-top` (operacion.css: el alto de las barras más un
 * respiro), y desde ahí el primer Tab entra al campo. Antes era el `autofocus`, cuyo desplazamiento depende del motor:
 * con el Chromium de swiftshader del recorrido lo dejaba bajo la barra (docs/evidencia/ola-r2-pld/sexta). La llave del
 * estado pasa a ser este permalink: cada formulario repetido en una página lleva su propio idAviso. Con JavaScript no
 * tiene efecto.
 */
export function permalinkDelRechazo(idAviso: string): string {
  return `#${idAviso}-campo`;
}

/**
 * Lo mismo para las páginas que marcan el campo con el aviso de la dirección (`?aviso=…&en=…`, tras una redirección):
 * si el error es de un campo, la redirección lleva el fragmento de su mensaje (`MensajeDelCampo` con el id de la página);
 * si no, ninguno y el aviso queda arriba de la página. Es el único fragmento que una dirección de Operación puede llevar.
 */
export function fragmentoDelError(codigo: string): string {
  return avisoDeCampo(codigo) ? `#${ID_AVISO}-campo` : "";
}

/**
 * El texto del error junto al campo que lo causó, justo después del control; el aviso de arriba queda como resumen.
 * Es la descripción que `errorDelCampo` le pone al campo, así que el lector la oye una vez, al llegar al campo. Sin
 * error no pinta nada. Cada página (o formulario con su propio aviso) marca un solo campo a la vez: el id no se repite.
 */
export function MensajeDelCampo({ codigo, campo, idAviso = ID_AVISO }: { codigo: string | null | undefined; campo: string; idAviso?: string }) {
  if (!esDelCampo(codigo, campo)) return null;
  return <MensajeJuntoAlCampo id={`${idAviso}-campo`} texto={textoDelAviso(codigo)} />;
}

function esDelCampo(codigo: string | null | undefined, campo: string): codigo is string {
  if (!codigo) return false;
  // El campo sale del catálogo o del prefijo, como en `avisoDeCampo`; otro código no es de ningún campo.
  const prefijo = /^(dato_invalido|invisible)_/;
  return (deCatalogo(CAMPO, codigo) ?? (prefijo.test(codigo) ? codigo.replace(prefijo, "") : null)) === campo;
}
