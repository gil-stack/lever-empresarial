import { randomUUID } from "node:crypto";

import {
  clavesExactas,
  esRegistro,
  exigirUuid,
  leerInstante,
  rechazarAuditoria,
  rechazarSiHayMaterial,
} from "../audit/material";

/**
 * Auditoría de la autenticación. Mismas seis claves, sin cuerpo: no hay sitio
 * para una contraseña, una semilla, un código ni un token. Es un acto de la
 * persona, no de una empresa, así que `companyId` va vacío. `actorId` va
 * vacío cuando quien actúa todavía no probó quién es.
 */

export const INSERT_HECHO_AUTENTICACION = `insert into audit_events (
  id,
  company_id,
  actor_id,
  accion,
  entidad,
  identificador,
  ocurrido_en
) values ($1, $2, $3, $4, $5, $6, $7)`;

export const PARES_AUTENTICACION = {
  entrada_contrasena: "auth_entradas",
  entrada_fallida: "users",
  segundo_factor_fallido: "auth_entradas",
  entrada_completa: "sessions",
  passkey_registrada: "auth_passkeys",
  passkey_revocada: "auth_passkeys",
  totp_confirmado: "auth_totp",
  totp_revocado: "auth_totp",
  respaldo_generado: "users",
  respaldo_usado: "auth_codigos_respaldo",
  recuperacion_solicitada: "auth_recuperaciones",
  recuperacion_aprobada: "auth_recuperaciones",
  recuperacion_rechazada: "auth_recuperaciones",
  recuperacion_cumplida: "auth_recuperaciones",
  recuperacion_vencida: "auth_recuperaciones",
} as const;

export type AccionAutenticacion = keyof typeof PARES_AUTENTICACION;

export type HechoAutenticacion = {
  companyId: null;
  actorId: string | null;
  accion: AccionAutenticacion;
  entidad: (typeof PARES_AUTENTICACION)[AccionAutenticacion];
  identificador: string;
  ocurridoEn: Date | string;
};

type Consulta = {
  query: (sql: string, params: readonly unknown[]) => unknown;
};

export function hecho(
  accion: AccionAutenticacion,
  identificador: string,
  actorId: string | null,
  ocurridoEn: Date,
): HechoAutenticacion {
  return { companyId: null, actorId, accion, entidad: PARES_AUTENTICACION[accion], identificador, ocurridoEn };
}

function preparar(evento: unknown) {
  if (!esRegistro(evento)) rechazarAuditoria("evento_invalido");
  rechazarSiHayMaterial(evento);
  if (!clavesExactas(evento)) rechazarAuditoria("evento_invalido");
  if (evento.companyId !== null) rechazarAuditoria("evento_invalido");
  const accion = evento.accion;
  if (typeof accion !== "string" || !Object.hasOwn(PARES_AUTENTICACION, accion)) {
    rechazarAuditoria("evento_invalido");
  }
  const entidad = PARES_AUTENTICACION[accion as AccionAutenticacion];
  if (evento.entidad !== entidad) rechazarAuditoria("evento_invalido");
  return {
    actorId: evento.actorId === null ? null : exigirUuid(evento.actorId),
    accion: accion as AccionAutenticacion,
    entidad,
    identificador: exigirUuid(evento.identificador),
    ocurridoEn: leerInstante(evento.ocurridoEn),
  };
}

export async function registrarHechoAutenticacion(evento: HechoAutenticacion, consulta: Consulta): Promise<void> {
  const fila = preparar(evento);
  if (!esRegistro(consulta) || typeof consulta.query !== "function") {
    rechazarAuditoria("consulta_invalida");
  }
  await consulta.query(INSERT_HECHO_AUTENTICACION, [
    randomUUID(),
    null,
    fila.actorId,
    fila.accion,
    fila.entidad,
    fila.identificador,
    fila.ocurridoEn,
  ]);
}
