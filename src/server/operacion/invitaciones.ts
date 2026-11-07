import { randomUUID } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { textoOperativo, uuidValido } from "../../dominio/operacion";
import { emitirEnTransaccion, emitirToken } from "../invitaciones/repositorio";
import { entregarInvitacion } from "../invitaciones/servicio";
import type { InvitacionEmitida } from "../invitaciones/tipos";
import { correoValido, normalizarCorreo } from "../session/validar";
import { auditarOperacion } from "./auditar";
import { exigirEnOperacion } from "./permisos";

export type ResultadoInvitacionOperacion = {
  invitationId: string;
  entrega: "omitida_desarrollo" | "enviada" | "fallida";
  detalle: string | null;
  expiraEn: Date;
};

type Dependencias = {
  entregar?: typeof entregarInvitacion;
  produccion?: boolean;
  ahora?: () => Date;
};

/** Un doble clic dura menos de medio segundo; leer un aviso y volver a reenviar, varios segundos. */
const VENTANA_DE_DOBLE_CLIC_MS = 2_000;

/**
 * Emite o reenvía por los servicios existentes. El token nunca sale de este módulo.
 *
 * `vista` es la última invitación que la persona tenía en pantalla ("" si no había): solo se emite
 * si sigue siendo la última. Así una pestaña vieja, o dos personas a la vez, no mandan dos correos ni
 * anulan el enlace que acaba de salir. Como la pantalla se refresca antes del segundo clic de un doble
 * clic, además no se emite otra si la última salió hace menos de `VENTANA_DE_DOBLE_CLIC_MS`.
 */
export async function invitarPrimerAdministrador(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; nombre: unknown; correo: unknown; vista?: unknown },
  deps: Dependencias = {},
): Promise<ResultadoInvitacionOperacion> {
  exigirEnOperacion(ctx, "plataforma.invitacion.emitir");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  const nombre = textoOperativo(entrada.nombre, 200);
  const correo = normalizarCorreo(typeof entrada.correo === "string" ? entrada.correo : "");
  if (!nombre || !correoValido(correo)) throw new ErrorDeDominio("invitacion_invalida");
  const ahora = (deps.ahora ?? (() => new Date()))();
  const produccion = deps.produccion ?? process.env.NODE_ENV === "production";
  const emitida = await conContexto(basePlataforma(ctx, entrada.companyId), async (consulta) => {
    const empresa = await consulta.query("select razon_social, estado from companies where id = $1 for update", [
      entrada.companyId,
    ]);
    const fila = empresa.rows[0] as { razon_social?: unknown; estado?: unknown } | undefined;
    if (!fila) throw new ErrorDeDominio("cliente_ausente");
    // Desde una ficha abierta antes de la suspensión, el aviso dice el motivo real.
    if (fila.estado === "suspendida") throw new ErrorDeDominio("empresa_suspendida");
    if (fila.estado !== "activa") throw new ErrorDeDominio("cliente_no_activo");
    const ultima = await consulta.query(
      "select id, emitida_en from invitations where company_id = $1 order by emitida_en desc, id desc limit 1",
      [entrada.companyId],
    );
    const previa = ultima.rows[0] as { id?: unknown; emitida_en?: unknown } | undefined;
    if (typeof entrada.vista === "string" && entrada.vista !== (typeof previa?.id === "string" ? previa.id : "")) {
      throw new ErrorDeDominio("invitacion_ya_enviada");
    }
    if (previa?.emitida_en instanceof Date && ahora.getTime() - previa.emitida_en.getTime() < VENTANA_DE_DOBLE_CLIC_MS) {
      throw new ErrorDeDominio("invitacion_ya_enviada");
    }
    const existente = await consulta.query(
      `select m.user_id, m.estado, u.nombre, u.correo
       from memberships m
       join membership_roles r on r.company_id = m.company_id and r.user_id = m.user_id and r.rol = 'administrador'
       join users u on u.id = m.user_id
       where m.company_id = $1
       order by m.alta_en, m.user_id
       for update of m`,
      [entrada.companyId],
    );
    const administradores = existente.rows as Array<Record<string, unknown>>;
    if (administradores.some((admin) => admin.estado === "activa")) throw new ErrorDeDominio("administrador_existente");
    const previo = administradores[0];
    if (previo && typeof previo.user_id === "string") {
      return emitirToken(consulta, {
        operadorId: ctx.personal.operadorId,
        companyId: entrada.companyId as string,
        actorTipo: "personal",
        actorId: ctx.persona.id,
        superficie: "sofipo",
        peticionId: ctx.peticionId,
        origen: "operacion",
      }, {
        operadorId: ctx.personal.operadorId,
        companyId: entrada.companyId as string,
        userId: previo.user_id,
        nombre: String(previo.nombre),
        correo: String(previo.correo),
        roles: ["administrador"],
        ahora,
      });
    }
    return emitirEnTransaccion(consulta, {
      operadorId: ctx.personal.operadorId,
      companyId: entrada.companyId as string,
      actorTipo: "personal",
      actorId: ctx.persona.id,
      superficie: "sofipo",
      peticionId: ctx.peticionId,
      origen: "operacion",
    }, {
      operadorId: ctx.personal.operadorId,
      nombre,
      correo,
      destino: { tipo: "empresa", companyId: entrada.companyId as string, roles: ["administrador"] },
      ahora,
    });
  });

  if (!produccion) {
    await registrarEntrega(ctx, emitida, "omitida_desarrollo", "correo_deshabilitado", ahora);
    return { invitationId: emitida.invitacionId, entrega: "omitida_desarrollo", detalle: "correo_deshabilitado", expiraEn: emitida.expiraEn };
  }

  const razonSocial = await razonSocialDe(ctx, entrada.companyId);
  const entrega = await (deps.entregar ?? entregarInvitacion)(emitida, razonSocial);
  const estado = entrega.entregada ? "enviada" : "fallida";
  const detalle = entrega.entregada ? null : entrega.codigo;
  await registrarEntrega(ctx, emitida, estado, detalle, new Date());
  return { invitationId: emitida.invitacionId, entrega: estado, detalle, expiraEn: emitida.expiraEn };
}

async function registrarEntrega(
  ctx: ContextoDePersonal,
  emitida: InvitacionEmitida,
  estado: "omitida_desarrollo" | "enviada" | "fallida",
  detalle: string | null,
  ahora: Date,
): Promise<void> {
  if (!emitida.companyId) throw new ErrorDeDominio("invitacion_invalida");
  const id = randomUUID();
  await conContexto(basePlataforma(ctx, emitida.companyId), async (consulta) => {
    await consulta.query(
      `insert into invitation_deliveries (
        id, operator_id, company_id, invitation_id, registrada_por, registrada_en, estado, detalle
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, ctx.personal.operadorId, emitida.companyId, emitida.invitacionId, ctx.persona.id, ahora, estado, detalle],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: emitida.companyId,
      accion: "invitacion_entrega_registrada",
      identificador: id,
      ocurridoEn: ahora,
    });
  });
}

async function razonSocialDe(ctx: ContextoDePersonal, companyId: string): Promise<string> {
  const resultado = await conContexto(basePlataforma(ctx, companyId), (consulta) =>
    consulta.query("select razon_social from companies where id = $1", [companyId]),
  );
  const fila = resultado.rows[0] as { razon_social?: unknown } | undefined;
  if (typeof fila?.razon_social !== "string") throw new ErrorDeDominio("cliente_ausente");
  return fila.razon_social;
}
