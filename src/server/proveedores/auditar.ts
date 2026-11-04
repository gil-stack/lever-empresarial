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
 * Auditoría del alta de proveedor. Mismas seis claves, sin cuerpo.
 * No cabe la CLABE, ni el RFC, ni la clave del archivo, ni un connection string.
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
  alta_proveedor: "suppliers",
  clabe_proveedor: "supplier_clabes",
} as const;

export type AccionProveedor = keyof typeof PARES;
export type EntidadProveedor = (typeof PARES)[AccionProveedor];

export type HechoProveedor = {
  companyId: string;
  actorId: string;
  accion: AccionProveedor;
  entidad: EntidadProveedor;
  identificador: string;
  ocurridoEn: Date | string;
};

type Consulta = {
  query: (sql: string, params: readonly unknown[]) => unknown;
};

function preparar(evento: unknown): {
  companyId: string;
  actorId: string;
  accion: AccionProveedor;
  entidad: EntidadProveedor;
  identificador: string;
  ocurridoEn: Date;
} {
  if (!esRegistro(evento)) rechazarAuditoria("evento_invalido");
  rechazarSiHayMaterial(evento);
  if (!clavesExactas(evento)) rechazarAuditoria("evento_invalido");

  const accion = evento.accion;
  const entidad = evento.entidad;
  if (typeof accion !== "string" || !(accion in PARES)) rechazarAuditoria("evento_invalido");
  const esperada = PARES[accion as AccionProveedor];
  if (entidad !== esperada) rechazarAuditoria("evento_invalido");

  return {
    companyId: exigirUuid(evento.companyId),
    actorId: exigirUuid(evento.actorId),
    accion: accion as AccionProveedor,
    entidad: esperada,
    identificador: exigirUuid(evento.identificador),
    ocurridoEn: leerInstante(evento.ocurridoEn),
  };
}

export async function registrarHechoProveedor(evento: HechoProveedor, consulta: Consulta): Promise<void> {
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

/** La CLABE usa el mismo registro. No lleva los 18 dígitos. */
export type HechoClabe = HechoProveedor;
export const registrarHechoClabe = registrarHechoProveedor;
