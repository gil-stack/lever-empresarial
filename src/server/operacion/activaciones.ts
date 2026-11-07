import { randomUUID } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { uuidValido } from "../../dominio/operacion";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion";
import type { Sesion } from "../session/tipos";
import { auditarOperacion } from "./auditar";
import { cerrarAlertasDeCategoria } from "./alertas";
import type { SolicitudActivacion } from "./tipos";
import { motivoEscrito } from "./formulario";
import { exigirEnOperacion } from "./permisos";

export async function solicitarActivacion(ctx: ContextoDePersonal, companyId: unknown): Promise<string> {
  exigirEnOperacion(ctx, "plataforma.activacion.solicitar");
  if (!uuidValido(companyId)) throw new ErrorDeDominio("cliente_ausente");
  const id = randomUUID();
  const ahora = new Date();
  await conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    await bloquearEmpresaEnEstado(consulta, companyId, "prospecto");
    await consulta.query(
      `insert into company_activation_requests (
        id, operator_id, company_id, requested_by, requested_at
      ) values ($1, $2, $3, $4, $5)`,
      [id, ctx.personal.operadorId, companyId, ctx.persona.id, ahora],
    );
    await consulta.query("update companies set estado = 'en_alta' where id = $1 and estado = 'prospecto'", [companyId]);
    await consulta.query(
      `insert into company_state_history (
        id, operator_id, company_id, estado_anterior, estado_nuevo, actor_id, request_id, ocurrido_en
      ) values ($1, $2, $3, 'prospecto', 'en_alta', $4, $5, $6)`,
      [randomUUID(), ctx.personal.operadorId, companyId, ctx.persona.id, id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId,
      accion: "activacion_solicitada",
      identificador: id,
      ocurridoEn: ahora,
    });
  });
  return id;
}

export async function decidirActivacion(
  ctx: ContextoDePersonal,
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  entrada: { id: unknown; aprobada: boolean; motivo?: unknown },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.activacion.aprobar");
  exigirAutenticacionReciente(sesion);
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("solicitud_ausente");
  const motivo = entrada.aprobada ? null : motivoEscrito(entrada.motivo, 500);
  const ahora = new Date();
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const solicitud = await bloquearSolicitud(consulta, entrada.id as string);
    if (solicitud.requestedBy === ctx.persona.id) throw new ErrorDeDominio("misma_persona_en_activacion");
    await bloquearEmpresaEnEstado(consulta, solicitud.companyId, "en_alta");
    const estado = entrada.aprobada ? "aprobada" : "rechazada";
    const estadoEmpresa = entrada.aprobada ? "activa" : "prospecto";
    const accion = entrada.aprobada ? "activacion_aprobada" : "activacion_rechazada";
    const decidida = await consulta.query(
      `update company_activation_requests
       set estado = $2, decided_by = $3, decided_at = $4, motivo = $5
       where id = $1 and estado = 'pendiente'`,
      [solicitud.id, estado, ctx.persona.id, ahora, motivo],
    );
    if (decidida.rowCount !== 1) throw new ErrorDeDominio("solicitud_ausente");
    await consulta.query("update companies set estado = $2 where id = $1 and estado = 'en_alta'", [
      solicitud.companyId,
      estadoEmpresa,
    ]);
    await consulta.query(
      `insert into company_state_history (
        id, operator_id, company_id, estado_anterior, estado_nuevo, actor_id, request_id, ocurrido_en
      ) values ($1, $2, $3, 'en_alta', $4, $5, $6, $7)`,
      [randomUUID(), ctx.personal.operadorId, solicitud.companyId, estadoEmpresa, ctx.persona.id, solicitud.id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: solicitud.companyId,
      accion,
      identificador: solicitud.id,
      motivo,
      ocurridoEn: ahora,
    });
    await cerrarAlertasDeCategoria(
      consulta,
      ctx,
      solicitud.companyId,
      "activacion",
      entrada.aprobada ? "Activación para el portal aprobada por otra persona." : `Solicitud rechazada: ${motivo}`,
      ahora,
    );
  });
}

export async function listarSolicitudesActivacion(ctx: ContextoDePersonal): Promise<SolicitudActivacion[]> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select r.id, r.company_id, c.razon_social, c.rfc, r.requested_by,
        u.nombre as solicitante, r.requested_at
       from company_activation_requests r
       join companies c on c.id = r.company_id
       join users u on u.id = r.requested_by
       where r.estado = 'pendiente'
       order by r.requested_at, r.id`,
      [],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    companyId: String(fila.company_id),
    razonSocial: String(fila.razon_social),
    rfc: String(fila.rfc),
    solicitadaPor: String(fila.requested_by),
    solicitante: String(fila.solicitante),
    solicitadaEn: fecha(fila.requested_at),
  }));
}

async function bloquearEmpresaEnEstado(consulta: Consulta, companyId: string, estado: string): Promise<void> {
  const empresa = await consulta.query("select estado from companies where id = $1 for update", [companyId]);
  const fila = empresa.rows[0] as { estado?: unknown } | undefined;
  if (!fila) throw new ErrorDeDominio("cliente_ausente");
  if (fila.estado !== estado) throw new ErrorDeDominio("activacion_transicion_invalida");
}

async function bloquearSolicitud(
  consulta: Consulta,
  id: string,
): Promise<{ id: string; companyId: string; requestedBy: string }> {
  const resultado = await consulta.query(
    "select id, company_id, requested_by, estado from company_activation_requests where id = $1 for update",
    [id],
  );
  const fila = resultado.rows[0] as Record<string, unknown> | undefined;
  if (!fila) throw new ErrorDeDominio("solicitud_ausente");
  if (fila.estado !== "pendiente") throw new ErrorDeDominio("solicitud_ya_decidida");
  return { id, companyId: String(fila.company_id), requestedBy: String(fila.requested_by) };
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
