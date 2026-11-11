import { randomUUID } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { uuidValido } from "../../dominio/operacion";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion";
import type { Sesion } from "../session/tipos";
import { auditarOperacion } from "./auditar";
import { exigirEnOperacion } from "./permisos";
import { motivoEscrito, unaVezPorFormulario, type EnvolturaDeTransaccion } from "./formulario";

type SesionConFactor = Pick<Sesion, "segundoFactor" | "superficie">;

export type SuspensionPendiente = {
  id: string;
  companyId: string;
  razonSocial: string;
  rfc: string;
  tipo: "suspension" | "reactivacion";
  motivo: string;
  solicitadaPor: string;
  solicitadaPorId: string;
  solicitadaEn: Date;
};

export type SuspensionLeida = {
  id: string;
  tipo: "suspension" | "reactivacion";
  origen: "manual" | "lpb";
  estado: "pendiente" | "aprobada" | "rechazada";
  motivo: string;
  solicitadaPor: string | null;
  decididaPor: string | null;
  solicitadaEn: Date;
  decididaEn: Date | null;
  motivoDecision: string | null;
};

/** Originación o Cumplimiento pide suspender o reactivar, con motivo. Decide otra persona con rol de aprobación. */
export async function solicitarCambioDeSuspension(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; formId: unknown; tipo: unknown; motivo: unknown },
  envolver: EnvolturaDeTransaccion = (consulta) => consulta,
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.suspension.solicitar");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const tipo = entrada.tipo === "reactivacion" ? "reactivacion" : entrada.tipo === "suspension" ? "suspension" : null;
  if (!tipo) throw new ErrorDeDominio("dato_invalido_tipo");
  const motivo = motivoEscrito(entrada.motivo, 500);
  const ahora = new Date();
  const companyId = entrada.companyId;
  await unaVezPorFormulario(() => conContexto(basePlataforma(ctx, companyId), async (transaccion) => {
    const consulta = envolver(transaccion);
    // El formulario y la solicitud pendiente de la empresa en una sola lectura, con la misma foto (como
    // `crearVersion`). Un segundo clic encuentra su solicitud; un formulario de otra empresa no vale. Con dos
    // lecturas, si la otra pestaña del mismo formulario confirmaba entre ellas, la segunda veía su solicitud como
    // «ya hay una pendiente». Si confirma después de esta lectura, el insert choca con la llave y se repite.
    const vistas = await consulta.query(
      "select id, company_id from company_suspensions where id = $1 or (company_id = $2 and estado = 'pendiente')",
      [entrada.formId, entrada.companyId],
    );
    const filas = vistas.rows as Array<{ id: string; company_id: string }>;
    const propia = filas.find((fila) => fila.id === entrada.formId);
    if (propia) {
      if (propia.company_id === companyId) return;
      throw new ErrorDeDominio("formulario_invalido");
    }
    if (filas.length > 0) throw new ErrorDeDominio("suspension_pendiente");
    await consulta.query(
      `insert into company_suspensions (id, operator_id, company_id, tipo, origen, motivo, solicitada_por, solicitada_en)
       values ($1, $2, $3, $4, 'manual', $5, $6, $7)`,
      [entrada.formId, ctx.personal.operadorId, entrada.companyId, tipo, motivo, ctx.persona.id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: entrada.companyId as string,
      accion: tipo === "suspension" ? "suspension_solicitada" : "reactivacion_solicitada",
      identificador: entrada.formId as string,
      motivo,
      ocurridoEn: ahora,
    });
  }), "formulario_invalido");
}

/**
 * Aprobación decide. Aprobada, la empresa cambia de estado en la misma
 * transacción, con su historial y su evento. Reactivar con una coincidencia
 * abierta lo rechaza la base (77ª): primero el dictamen de falso positivo.
 * Devuelve la empresa y si quedó reactivada: quien llama procesa después del
 * commit los abonos que se retuvieron mientras estuvo suspendida (r63i-N1).
 */
export async function decidirCambioDeSuspension(
  ctx: ContextoDePersonal,
  sesion: SesionConFactor,
  entrada: { id: unknown; aprobada: boolean; motivo: unknown },
): Promise<{ companyId: string; reactivada: boolean }> {
  exigirEnOperacion(ctx, "plataforma.suspension.aprobar");
  exigirAutenticacionReciente(sesion);
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("solicitud_ausente");
  const motivo = entrada.aprobada ? null : motivoEscrito(entrada.motivo, 500);
  const ahora = new Date();
  return conContexto(basePlataforma(ctx), async (consulta) => {
    const fila = await consulta.query(
      "select company_id, tipo, estado, solicitada_por from company_suspensions where id = $1 for update",
      [entrada.id],
    );
    const solicitud = fila.rows[0] as { company_id?: unknown; tipo?: unknown; estado?: unknown; solicitada_por?: unknown } | undefined;
    if (!solicitud) throw new ErrorDeDominio("solicitud_ausente");
    if (solicitud.estado !== "pendiente") throw new ErrorDeDominio("solicitud_ya_decidida");
    if (solicitud.solicitada_por === ctx.persona.id) throw new ErrorDeDominio("misma_persona_en_suspension");
    const companyId = String(solicitud.company_id);
    const tipo = solicitud.tipo === "reactivacion" ? "reactivacion" : "suspension";
    await consulta.query(
      "update company_suspensions set estado = $2, decidida_por = $3, decidida_en = $4, motivo_decision = $5 where id = $1",
      [entrada.id, entrada.aprobada ? "aprobada" : "rechazada", ctx.persona.id, ahora, motivo],
    );
    if (entrada.aprobada) {
      const antes = tipo === "suspension" ? "activa" : "suspendida";
      const despues = tipo === "suspension" ? "suspendida" : "activa";
      const cambiada = await consulta.query("update companies set estado = $2 where id = $1 and estado = $3", [companyId, despues, antes]);
      if (cambiada.rowCount !== 1) throw new ErrorDeDominio(tipo === "suspension" ? "suspension_no_aplica" : "reactivacion_no_aplica");
      await consulta.query(
        `insert into company_state_history (id, operator_id, company_id, estado_anterior, estado_nuevo, actor_id, suspension_id, ocurrido_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), ctx.personal.operadorId, companyId, antes, despues, ctx.persona.id, entrada.id, ahora],
      );
    }
    await auditarOperacion(consulta, ctx, {
      companyId,
      accion: `${tipo}_${entrada.aprobada ? "aprobada" : "rechazada"}` as
        | "suspension_aprobada" | "suspension_rechazada" | "reactivacion_aprobada" | "reactivacion_rechazada",
      identificador: entrada.id as string,
      motivo,
      ocurridoEn: ahora,
    });
    return { companyId, reactivada: entrada.aprobada && tipo === "reactivacion" };
  });
}

export async function listarSuspensionesPendientes(ctx: ContextoDePersonal): Promise<SuspensionPendiente[]> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select s.id, s.company_id, c.razon_social, c.rfc, s.tipo, s.motivo, s.solicitada_por, u.nombre, s.solicitada_en
       from company_suspensions s join companies c on c.id = s.company_id join users u on u.id = s.solicitada_por
       where s.estado = 'pendiente' order by s.solicitada_en, s.id`,
      [],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    companyId: String(fila.company_id),
    razonSocial: String(fila.razon_social),
    rfc: String(fila.rfc),
    tipo: fila.tipo === "reactivacion" ? "reactivacion" : "suspension",
    motivo: String(fila.motivo),
    solicitadaPor: String(fila.nombre),
    solicitadaPorId: String(fila.solicitada_por),
    solicitadaEn: fecha(fila.solicitada_en),
  }));
}

export async function listarSuspensionesDeEmpresa(ctx: ContextoDePersonal, companyId: string): Promise<SuspensionLeida[]> {
  exigirEnOperacion(ctx, "plataforma.expediente.ver");
  if (!uuidValido(companyId)) return [];
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select s.*, a.nombre as solicitante, b.nombre as decisor
       from company_suspensions s left join users a on a.id = s.solicitada_por left join users b on b.id = s.decidida_por
       where s.company_id = $1 order by s.solicitada_en desc limit 20`,
      [companyId],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    tipo: fila.tipo === "reactivacion" ? "reactivacion" : "suspension",
    origen: fila.origen === "lpb" ? "lpb" : "manual",
    estado: String(fila.estado) as SuspensionLeida["estado"],
    motivo: String(fila.motivo),
    solicitadaPor: typeof fila.solicitante === "string" ? fila.solicitante : null,
    decididaPor: typeof fila.decisor === "string" ? fila.decisor : null,
    solicitadaEn: fecha(fila.solicitada_en),
    decididaEn: fila.decidida_en ? fecha(fila.decidida_en) : null,
    motivoDecision: typeof fila.motivo_decision === "string" ? fila.motivo_decision : null,
  }));
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
