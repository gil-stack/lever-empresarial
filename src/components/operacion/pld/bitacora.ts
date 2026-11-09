import type { AccionPld } from "@/server/pld/auditar";

/**
 * Cómo se leen en la bitácora los eventos de PLD. La base solo deja leer los que
 * empiezan con «pld_» a Cumplimiento y Auditoría; el perfil es parte del expediente.
 */
export const ETIQUETAS_PLD: Record<AccionPld | "pld_alerta_generada" | "pld_documento_descargado" | "pld_acta_descargada" | "pld_manifiesto_descargado", string> = {
  expediente_perfil_declarado: "Declaró el perfil transaccional",
  expediente_perfil_propuesto: "Propuso un cambio de perfil transaccional a Cumplimiento",
  expediente_perfil_aprobado: "Aprobó el cambio de perfil propuesto",
  expediente_perfil_rechazado: "Rechazó el cambio de perfil propuesto",
  pld_perfil_actualizado: "Actualizó el perfil vigente",
  pld_evaluacion_registrada: "Registró la evaluación semestral",
  pld_parametros_cambiados: "Cambió los parámetros de las alertas",
  pld_alerta_generada: "El sistema generó una alerta PLD",
  pld_aviso_emitido: "Emitió un aviso a Cumplimiento",
  pld_caso_abierto: "Abrió un caso de análisis",
  pld_caso_alerta_agregada: "Sumó una alerta al caso",
  pld_caso_24_horas: "Marcó el caso como reporte de 24 horas",
  pld_caso_consultado: "Consultó un caso de análisis",
  pld_nota_agregada: "Agregó una nota al caso",
  pld_documento_cargado: "Cargó un documento al caso",
  pld_documento_descargado: "Descargó un documento del caso",
  pld_propuesta_registrada: "Registró la propuesta del caso",
  pld_voto_registrado: "Anotó un voto del Comité",
  pld_dictamen_registrado: "Registró el dictamen",
  pld_reporte_registrado: "Anotó el acuse del reporte",
  pld_modo_dictamen_cambiado: "Cambió quién dictamina",
  pld_comite_integrante_designado: "Designó a un integrante del Comité",
  pld_comite_integrante_sustituido: "Sustituyó a un integrante del Comité",
  pld_comite_auditor_designado: "Registró al auditor interno",
  pld_comite_comunicacion_registrada: "Anotó el aviso de integración del Comité",
  pld_sesion_registrada: "Registró una sesión del Comité",
  pld_acta_cargada: "Subió el acta firmada",
  pld_acta_descargada: "Descargó un acta del Comité",
  pld_entidad_registrada: "Registró la clave de la entidad",
  pld_periodico_registrado: "Registró un reporte periódico",
  pld_archivo_generado: "Generó el archivo de un reporte periódico",
  pld_manifiesto_descargado: "Descargó el manifiesto de conservación",
};
