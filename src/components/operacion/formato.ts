import { ETIQUETAS_PLD } from "./pld/bitacora";

export function fechaHora(valor: Date): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(valor);
}

export function fechaDia(valor: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${valor}T00:00:00Z`));
}

export function etiquetaEstado(estado: string): string {
  const etiquetas: Record<string, string> = {
    prospecto: "Prospecto",
    en_alta: "En alta",
    activa: "Activa para portal",
    suspendida: "Suspendida",
    baja: "Baja",
    pendiente: "Pendiente",
    vigente: "Vigente",
    rechazada: "Rechazada",
    cerrada: "Cerrada",
    abierta: "Abierta",
    aprobada: "Aprobada",
  };
  return etiquetas[estado] ?? estado;
}

/** Los regímenes y usos que ofrece el alta de prospecto; la ficha los muestra con su nombre. */
export const REGIMENES = [
  ["601", "General de ley"],
  ["612", "Actividades empresariales"],
  ["620", "Sociedad cooperativa"],
  ["626", "Simplificado de confianza"],
  ["603", "Instituciones sin fines de lucro"],
] as const;

export const USOS_CFDI = [
  ["G03", "Gastos en general"],
  ["S01", "Sin efectos fiscales"],
  ["CP01", "Pagos"],
] as const;

export function conNombre(catalogo: ReadonlyArray<readonly [string, string]>, clave: string): string {
  const nombre = catalogo.find(([valor]) => valor === clave)?.[1];
  return nombre ? `${clave} · ${nombre}` : clave;
}

export function etiquetaCategoria(categoria: string): string {
  const etiquetas: Record<string, string> = {
    activacion: "Activación",
    invitacion: "Invitación",
    comision: "Comisión",
    operativa: "Operativa",
  };
  return etiquetas[categoria] ?? categoria;
}

/** Por qué no salió un correo, en palabras; un código desconocido no se muestra. */
export function motivoDeEntrega(detalle: string | null): string | null {
  const motivos: Record<string, string> = {
    correo_deshabilitado: "El correo está apagado en este entorno.",
    correo_no_configurado: "Falta configurar el correo.",
    correo_rechazado: "El proveedor de correo rechazó la credencial o el remitente.",
    correo_destinatario_invalido: "El proveedor de correo no aceptó la dirección.",
    correo_limite: "El proveedor de correo pidió esperar.",
    correo_no_disponible: "El proveedor de correo no respondió.",
  };
  return detalle ? (motivos[detalle] ?? null) : null;
}

/**
 * La acción de la bitácora en palabras. Solo las que registran Operación y la entrada;
 * las demás se muestran con su código. La bitácora siempre enseña además el código y la tabla.
 */
/** Un código interno tal como se enseña en pantalla: sin el nombre del proveedor de los plásticos (efevoo_carga → tarjetas_carga). */
export function codigoVisible(codigo: string): string {
  return codigo.replace(/efevoo/gi, "tarjetas");
}

export function etiquetaAccion(accion: string): string | null {
  const etiquetas: Record<string, string> = {
    entrada_contrasena: "Contraseña correcta",
    entrada_completa: "Entró",
    entrada_fallida: "Intento de entrada fallido",
    salida: "Salió",
    reautenticacion: "Confirmó su identidad",
    totp_confirmado: "Registró su app autenticadora",
    respaldo_generado: "Generó códigos de respaldo",
    contrasena_restablecida: "Cambió su contraseña con el enlace",
    recuperacion_solicitada: "Pidió recuperar el acceso",
    recuperacion_aprobada: "Aprobó la recuperación",
    recuperacion_rechazada: "Rechazó la recuperación",
    emitir_invitacion: "Envió una invitación",
    aceptar_invitacion: "Aceptó la invitación",
    invitacion_entrega_registrada: "Anotó si salió el correo",
    alta_personal: "Alta de personal de Operación",
    alta_empresa: "Alta de empresa",
    prospecto_registrado: "Registró un prospecto",
    cliente_prueba_creado: "Dio de alta un cliente de prueba (alta rápida)",
    cliente_prueba_archivado: "Archivó un cliente de prueba",
    activacion_solicitada: "Pidió la activación",
    activacion_aprobada: "Aprobó la activación",
    activacion_rechazada: "Rechazó la activación",
    comision_solicitada: "Propuso una comisión",
    comision_aprobada: "Autorizó una comisión",
    comision_rechazada: "Rechazó una comisión",
    comision_cerrada: "Cerró una comisión",
    plan_actualizado: "Cambió un plan de mensualidad",
    plan_asignado: "Asignó un plan de mensualidad",
    alerta_creada: "Creó una alerta",
    alerta_asignada: "Reasignó una alerta",
    alerta_cerrada: "Cerró una alerta",
    alerta_configurada: "Configuró una alerta automática",
    publicar_precio: "Publicó el precio",
    rol_personal_asignado: "Asignó un rol del personal",
    rol_personal_retirado: "Quitó un rol del personal",
    expediente_consultado: "Abrió el expediente",
    efevoo_alta_cliente: "Dio de alta la empresa en tarjetas",
    efevoo_deposito_prueba: "Depósito de prueba al saldo de tarjetas",
    efevoo_asignacion: "Asignó una tarjeta",
    efevoo_activacion: "Activó una tarjeta",
    efevoo_asignacion_cliente: "Asignó tarjetas a la empresa",
    efevoo_carga: "Cargó saldo a una tarjeta",
    efevoo_retiro: "Retiró saldo de una tarjeta",
    efevoo_bloqueo: "Bloqueó una tarjeta",
    efevoo_desbloqueo: "Desbloqueó una tarjeta",
    efevoo_cancelacion: "Canceló una tarjeta",
    efevoo_confirmada: "Operación de tarjeta confirmada",
    efevoo_fallida: "Operación de tarjeta fallida",
    efevoo_incierta: "Operación de tarjeta incierta",
    efevoo_cierre_manual: "Cerró a mano una operación de tarjeta",
    expediente_documento_descargado: "Descargó un documento del expediente",
    expediente_version_creada: "Abrió una versión del expediente",
    expediente_datos_editados: "Editó los datos del expediente",
    expediente_representante_agregado: "Agregó un representante",
    expediente_representante_retirado: "Quitó un representante",
    expediente_accionista_agregado: "Agregó un accionista",
    expediente_accionista_retirado: "Quitó un accionista",
    expediente_documento_cargado: "Cargó un documento al expediente",
    expediente_enviado: "Envió el expediente a Cumplimiento",
    expediente_dictaminado: "Dictaminó el expediente",
    riesgo_calificado: "Calificó el grado de riesgo",
    lpb_cargada: "Cargó la Lista de Personas Bloqueadas",
    lpb_coincidencia_detectada: "El sistema detectó una coincidencia",
    lpb_coincidencia_resuelta: "Resolvió una coincidencia",
    lpb_reporte_registrado: "Anotó el folio del reporte",
    empresa_suspendida_lpb: "El sistema suspendió la empresa por la lista",
    suspension_solicitada: "Pidió suspender la empresa",
    suspension_aprobada: "Aprobó la suspensión",
    suspension_rechazada: "Rechazó la suspensión",
    reactivacion_solicitada: "Pidió reactivar la empresa",
    reactivacion_aprobada: "Aprobó la reactivación",
    reactivacion_rechazada: "Rechazó la reactivación",
    ...ETIQUETAS_PLD,
  };
  return etiquetas[accion] ?? null;
}
