import { randomUUID } from "node:crypto";

import type { ContextoDePersonal } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * Catálogo cerrado de los eventos de PLD y su entidad. Los que empiezan con
 * «pld_» solo los leen Cumplimiento y Auditoría, y nunca la persona excluida de
 * un aviso (0030, audit_log_sofipo_lectura). El portal del cliente no lee
 * ninguno (55ª). El perfil transaccional es parte del expediente.
 */
export const ENTIDADES_PLD = {
  expediente_perfil_declarado: "pld_perfiles",
  pld_perfil_actualizado: "pld_perfiles",
  pld_evaluacion_registrada: "pld_evaluaciones",
  pld_parametros_cambiados: "pld_parametros",
  pld_aviso_emitido: "pld_avisos",
  pld_caso_abierto: "pld_casos",
  pld_caso_alerta_agregada: "pld_casos",
  pld_caso_24_horas: "pld_casos",
  pld_caso_consultado: "pld_casos",
  pld_nota_agregada: "pld_notas",
  pld_documento_cargado: "pld_documentos",
  pld_propuesta_registrada: "pld_propuestas",
  pld_voto_registrado: "pld_votos",
  pld_dictamen_registrado: "pld_dictamenes",
  pld_reporte_registrado: "pld_reportes",
  pld_modo_dictamen_cambiado: "pld_modo_dictamen",
  pld_comite_integrante_designado: "pld_comite_integrantes",
  pld_comite_integrante_sustituido: "pld_comite_integrantes",
  pld_comite_auditor_designado: "pld_comite_auditores",
  pld_comite_comunicacion_registrada: "pld_comite_comunicaciones",
  pld_sesion_registrada: "pld_sesiones",
  pld_acta_cargada: "pld_actas",
  pld_entidad_registrada: "pld_entidad",
  pld_periodico_registrado: "pld_periodicos",
  pld_archivo_generado: "pld_periodicos",
} as const;

export type AccionPld = keyof typeof ENTIDADES_PLD;

const INSERTAR = `insert into audit_log (
  id, operator_id, company_id, actor_tipo, actor_id, superficie,
  accion, entidad, identificador, motivo, peticion_id, origen, ocurrido_en, cambio
) values ($1, $2, $3, 'personal', $4, 'sofipo', $5, $6, $7, $8, $9, 'operacion', $10, $11)`;

/** Nunca guarda nombres, RFC, CURP, CLABE ni textos libres en «cambio»: solo datos del catálogo. */
export async function auditarPld(
  consulta: Consulta,
  ctx: ContextoDePersonal,
  entrada: {
    companyId: string | null;
    accion: AccionPld;
    identificador: string;
    motivo?: string | null;
    ocurridoEn: Date;
    cambio?: Record<string, string | number | boolean> | null;
  },
): Promise<void> {
  const escrito = await consulta.query(INSERTAR, [
    randomUUID(),
    ctx.personal.operadorId,
    entrada.companyId,
    ctx.persona.id,
    entrada.accion,
    ENTIDADES_PLD[entrada.accion],
    entrada.identificador,
    entrada.motivo ? recortarMotivo(entrada.motivo) : null,
    ctx.peticionId,
    entrada.ocurridoEn,
    entrada.cambio ? JSON.stringify(entrada.cambio) : null,
  ]);
  if (escrito.rowCount !== 1) throw new ErrorDeDominio("auditoria_no_disponible");
}

/** audit_log.motivo admite 500 caracteres; un texto más largo se guarda completo en su tabla. */
function recortarMotivo(motivo: string): string {
  const caracteres = [...motivo];
  return caracteres.length <= 500 ? motivo : `${caracteres.slice(0, 499).join("")}…`;
}
