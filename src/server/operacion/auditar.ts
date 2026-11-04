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
} as const;

export type AccionOperacion = keyof typeof ENTIDADES;

const INSERTAR = `insert into audit_log (
  id, operator_id, company_id, actor_tipo, actor_id, superficie,
  accion, entidad, identificador, motivo, peticion_id, origen, ocurrido_en
) values ($1, $2, $3, 'personal', $4, 'sofipo', $5, $6, $7, $8, $9, 'operacion', $10)`;

/** Catálogo cerrado: ningún evento admite tokens, enlaces, correos ni datos sensibles. */
export async function auditarOperacion(
  consulta: Consulta,
  ctx: ContextoDePersonal,
  entrada: {
    companyId: string | null;
    accion: AccionOperacion;
    identificador: string;
    motivo?: string | null;
    ocurridoEn: Date;
  },
): Promise<void> {
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
  ]);
  if (escrito.rowCount !== 1) throw new ErrorDeDominio("auditoria_no_disponible");
}
