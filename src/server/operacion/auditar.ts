import { randomUUID } from "node:crypto";

import type { Consulta } from "../../nucleo/db";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

export const ENTIDADES = {
  prospecto_registrado: "companies",
  activacion_solicitada: "company_activation_requests",
  activacion_aprobada: "company_activation_requests",
  activacion_rechazada: "company_activation_requests",
  invitacion_entrega_registrada: "invitation_deliveries",
  alerta_creada: "operational_alerts",
  alerta_asignada: "operational_alerts",
  alerta_cerrada: "operational_alerts",
  comision_solicitada: "company_commissions",
  comision_aprobada: "company_commissions",
  comision_rechazada: "company_commissions",
  comision_cerrada: "company_commissions",
  // Ola R1: alta regulada. El identificador de los roles es la persona que los recibe.
  rol_personal_asignado: "platform_staff_roles",
  rol_personal_retirado: "platform_staff_roles",
  expediente_version_creada: "kyb_versiones",
  expediente_datos_editados: "kyb_versiones",
  expediente_enviado: "kyb_versiones",
  expediente_consultado: "companies",
  expediente_documento_cargado: "kyb_documentos",
  expediente_representante_agregado: "kyb_representantes",
  expediente_representante_retirado: "kyb_representantes",
  expediente_accionista_agregado: "kyb_accionistas",
  expediente_accionista_retirado: "kyb_accionistas",
  expediente_dictaminado: "kyb_dictamenes",
  riesgo_calificado: "kyb_calificaciones_riesgo",
  lpb_cargada: "lpb_cargas",
  lpb_coincidencia_resuelta: "lpb_coincidencias",
  lpb_reporte_registrado: "lpb_coincidencias",
  suspension_solicitada: "company_suspensions",
  reactivacion_solicitada: "company_suspensions",
  suspension_aprobada: "company_suspensions",
  suspension_rechazada: "company_suspensions",
  reactivacion_aprobada: "company_suspensions",
  reactivacion_rechazada: "company_suspensions",
  plan_actualizado: "billing_plans",
  plan_asignado: "company_billing_plans",
} as const;

export type AccionOperacion = keyof typeof ENTIDADES;

const INSERTAR = `insert into audit_log (
  id, operator_id, company_id, actor_tipo, actor_id, superficie,
  accion, entidad, identificador, motivo, peticion_id, origen, ocurrido_en, cambio
) values ($1, $2, $3, 'personal', $4, 'sofipo', $5, $6, $7, $8, $9, 'operacion', $10, $11)`;

/** El tope del motivo en la bitácora: el CHECK `audit_log_motivo_formato` (0017) cuenta caracteres, como aquí. */
export const MOTIVO_MAXIMO_BITACORA = 500;

/**
 * Catálogo cerrado: ningún evento admite tokens, enlaces, correos ni datos sensibles. Un motivo de más de 500
 * caracteres se rechaza aquí, con su aviso en el campo (`motivo_largo`), antes de que la bitácora lo rechace como
 * «La base no respondió»; nunca se trunca.
 */
export async function auditarOperacion(
  consulta: Consulta,
  ctx: ContextoDePersonal,
  entrada: {
    companyId: string | null;
    accion: AccionOperacion;
    identificador: string;
    motivo?: string | null;
    ocurridoEn: Date;
    /** Solo datos del catálogo (rol, resultado, grado): nunca nombres, RFC, CURP ni archivos. */
    cambio?: Record<string, string | number | boolean> | null;
  },
): Promise<void> {
  if (entrada.motivo && [...entrada.motivo].length > MOTIVO_MAXIMO_BITACORA) throw new ErrorDeDominio("motivo_largo");
  const escrito = await consulta.query(INSERTAR, [
    randomUUID(),
    ctx.personal.operadorId,
    entrada.companyId,
    ctx.persona.id,
    entrada.accion,
    ENTIDADES[entrada.accion],
    entrada.identificador,
    entrada.motivo ?? null,
    ctx.peticionId,
    entrada.ocurridoEn,
    entrada.cambio ? JSON.stringify(entrada.cambio) : null,
  ]);
  if (escrito.rowCount !== 1) throw new ErrorDeDominio("auditoria_no_disponible");
}
