import { randomUUID } from "node:crypto";

import {
  clavesExactas,
  esRegistro,
  exigirUuid,
  leerInstante,
  rechazarAuditoria,
  rechazarSiHayMaterial,
} from "./material";

/**
 * Auditoría del alta de la razón social.
 *
 * La sesión llama `registrarEvento(evento, consulta)` dentro de la misma
 * transacción que inserta la empresa. `consulta` ya es ese cliente: este
 * módulo no abre otra conexión y no lee variables de entorno. Otra conexión
 * sería otra transacción, y el alta podría quedar sin su auditoría.
 *
 * El evento dice quién (`actorId`), cuándo (`ocurridoEn`) y qué quedó
 * asentado: la acción, la entidad `companies` y el identificador de esa
 * empresa. La razón social, el RFC y el resto viven en `companies`.
 *
 * Lo que impide guardar un secreto es la forma del evento, no el recorrido
 * de patrones. Tienen que venir exactamente las seis claves, la acción y la
 * entidad están fijas, y los tres identificadores son UUID. El insert solo
 * escribe esas columnas. La tabla no tiene cuerpo libre. El recorrido de
 * patrones es una red de más: no sustituye esa lista blanca.
 *
 * Columnas de `audit_events`: id, company_id, actor_id, accion, entidad,
 * identificador, ocurrido_en. Solo hay insert.
 */

const INSERT_ALTA = `insert into audit_events (
  id,
  company_id,
  actor_id,
  accion,
  entidad,
  identificador,
  ocurrido_en
) values ($1, $2, $3, $4, $5, $6, $7)`;

const ACCION_ALTA = "alta_empresa";
const ENTIDAD_EMPRESA = "companies";

type EventoAlta = {
  companyId: string;
  actorId: string;
  accion: typeof ACCION_ALTA;
  entidad: typeof ENTIDAD_EMPRESA;
  identificador: string;
  ocurridoEn: Date | string;
};

type Consulta = {
  query: (sql: string, params: readonly unknown[]) => unknown;
};

function preparar(evento: unknown): {
  companyId: string;
  actorId: string;
  identificador: string;
  ocurridoEn: Date;
} {
  if (!esRegistro(evento)) rechazarAuditoria("evento_invalido");
  rechazarSiHayMaterial(evento);

  if (!clavesExactas(evento)) rechazarAuditoria("evento_invalido");
  if (evento.accion !== ACCION_ALTA || evento.entidad !== ENTIDAD_EMPRESA) {
    rechazarAuditoria("evento_invalido");
  }

  return {
    companyId: exigirUuid(evento.companyId),
    actorId: exigirUuid(evento.actorId),
    identificador: exigirUuid(evento.identificador),
    ocurridoEn: leerInstante(evento.ocurridoEn),
  };
}

export async function registrarEvento(evento: EventoAlta, consulta: Consulta): Promise<void> {
  const fila = preparar(evento);
  if (!esRegistro(consulta) || typeof consulta.query !== "function") {
    rechazarAuditoria("consulta_invalida");
  }

  await consulta.query(INSERT_ALTA, [
    randomUUID(),
    fila.companyId,
    fila.actorId,
    ACCION_ALTA,
    ENTIDAD_EMPRESA,
    fila.identificador,
    fila.ocurridoEn,
  ]);
}
