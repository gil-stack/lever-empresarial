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
 * Hechos de acceso: invitar, aceptar, revocar, pedir y usar una
 * recuperación. Misma tabla y mismas seis claves que el maestro, sin cuerpo:
 * no cabe el token, ni la contraseña, ni el correo.
 *
 * `companyId` va vacío cuando el acto es de la persona y no de una empresa
 * (la recuperación). `actorId` va vacío cuando actúa el sistema o cuando
 * quien pide la recuperación todavía no probó quién es; el identificador
 * apunta a la fila del token, que sí nombra a la persona.
 * La auditoría nueva de la fase 4 reemplaza esta función por la única.
 */

export const INSERT_HECHO_ACCESO = `insert into audit_events (
  id,
  company_id,
  actor_id,
  accion,
  entidad,
  identificador,
  ocurrido_en
) values ($1, $2, $3, $4, $5, $6, $7)`;

const PARES = {
  invitacion_creada: "invitations",
  invitacion_revocada: "invitations",
  invitacion_aceptada: "invitations",
  recuperacion_solicitada: "password_resets",
  contrasena_restablecida: "users",
} as const;

export type AccionAcceso = keyof typeof PARES;
export type EntidadAcceso = (typeof PARES)[AccionAcceso];

export type HechoAcceso = {
  companyId: string | null;
  actorId: string | null;
  accion: AccionAcceso;
  entidad: EntidadAcceso;
  identificador: string;
  ocurridoEn: Date | string;
};

type Consulta = {
  query: (sql: string, params: readonly unknown[]) => unknown;
};

export type Auditar = (evento: HechoAcceso, consulta: Consulta) => Promise<void>;

export async function registrarHechoAcceso(evento: HechoAcceso, consulta: Consulta): Promise<void> {
  if (!esRegistro(evento)) rechazarAuditoria("evento_invalido");
  rechazarSiHayMaterial(evento);
  if (!clavesExactas(evento)) rechazarAuditoria("evento_invalido");
  const accion = evento.accion;
  if (typeof accion !== "string" || !Object.hasOwn(PARES, accion)) rechazarAuditoria("evento_invalido");
  const entidad = PARES[accion as AccionAcceso];
  if (evento.entidad !== entidad) rechazarAuditoria("evento_invalido");
  const companyId = evento.companyId === null ? null : exigirUuid(evento.companyId);
  const actorId = evento.actorId === null ? null : exigirUuid(evento.actorId);
  const identificador = exigirUuid(evento.identificador);
  const ocurridoEn = leerInstante(evento.ocurridoEn);
  if (!esRegistro(consulta) || typeof consulta.query !== "function") {
    rechazarAuditoria("consulta_invalida");
  }
  await consulta.query(INSERT_HECHO_ACCESO, [
    randomUUID(),
    companyId,
    actorId,
    accion,
    entidad,
    identificador,
    ocurridoEn,
  ]);
}
