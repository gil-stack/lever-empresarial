import type { Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";

export type EventoDeAuditoria = {
  companyId: string | null;
  actorId: string | null;
  accion: "alta_empresa";
  entidad: "companies";
  identificador: string;
  ocurridoEn: Date;
};

export type AuditarAlta = (evento: EventoDeAuditoria, consulta: Consulta) => Promise<void>;

type ModuloAuditoria = {
  registrarEvento?: AuditarAlta;
};

export async function auditarAlta(evento: EventoDeAuditoria, consulta: Consulta): Promise<void> {
  let modulo: ModuloAuditoria;
  try {
    modulo = (await import("../audit")) as ModuloAuditoria;
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
  if (typeof modulo.registrarEvento !== "function") {
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
  await modulo.registrarEvento(evento, consulta);
}
