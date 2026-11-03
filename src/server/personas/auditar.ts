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
 * Auditoría del maestro. Misma tabla, mismas seis claves, sin cuerpo.
 * No cabe la CLABE, ni la contraseña, ni un connection string.
 */

export const INSERT_HECHO = `insert into audit_events (
  id,
  company_id,
  actor_id,
  accion,
  entidad,
  identificador,
  ocurrido_en
) values ($1, $2, $3, $4, $5, $6, $7)`;

const PARES = {
  alta_persona: "employees",
  alta_centro_costo: "cost_centers",
  baja_persona: "employees",
} as const;

export type AccionMaestro = keyof typeof PARES;
export type EntidadMaestro = (typeof PARES)[AccionMaestro];

export type HechoMaestro = {
  companyId: string;
  actorId: string;
  accion: AccionMaestro;
  entidad: EntidadMaestro;
  identificador: string;
  ocurridoEn: Date | string;
};

type Consulta = {
  query: (sql: string, params: readonly unknown[]) => unknown;
};

function preparar(evento: unknown): {
  companyId: string;
  actorId: string;
  accion: AccionMaestro;
  entidad: EntidadMaestro;
  identificador: string;
  ocurridoEn: Date;
} {
  if (!esRegistro(evento)) rechazarAuditoria("evento_invalido");
  rechazarSiHayMaterial(evento);
  if (!clavesExactas(evento)) rechazarAuditoria("evento_invalido");

  const accion = evento.accion;
  const entidad = evento.entidad;
  if (typeof accion !== "string" || !(accion in PARES)) rechazarAuditoria("evento_invalido");
  const esperada = PARES[accion as AccionMaestro];
  if (entidad !== esperada) rechazarAuditoria("evento_invalido");

  return {
    companyId: exigirUuid(evento.companyId),
    actorId: exigirUuid(evento.actorId),
    accion: accion as AccionMaestro,
    entidad: esperada,
    identificador: exigirUuid(evento.identificador),
    ocurridoEn: leerInstante(evento.ocurridoEn),
  };
}

export async function registrarHechoMaestro(evento: HechoMaestro, consulta: Consulta): Promise<void> {
  const fila = preparar(evento);
  if (!esRegistro(consulta) || typeof consulta.query !== "function") {
    rechazarAuditoria("consulta_invalida");
  }

  await consulta.query(INSERT_HECHO, [
    randomUUID(),
    fila.companyId,
    fila.actorId,
    fila.accion,
    fila.entidad,
    fila.identificador,
    fila.ocurridoEn,
  ]);
}
