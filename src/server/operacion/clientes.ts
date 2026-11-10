import { randomUUID } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { uuidValido, type EstadoCliente } from "../../dominio/operacion";
import { auditar, actorDePersonal } from "../bitacora/auditar";
import { validarAlta } from "../company/validar";
import type { AltaEmpresaEntrada } from "../company/tipos";
import { auditarOperacion } from "./auditar";
import { crearAlertaEnTransaccion } from "./alertas";
import type { ClienteDetalle, ClienteResumen } from "./tipos";
import { exigirEnOperacion } from "./permisos";

export async function registrarProspecto(ctx: ContextoDePersonal, entrada: AltaEmpresaEntrada): Promise<string> {
  exigirEnOperacion(ctx, "plataforma.prospecto.registrar");
  const validada = validarAlta(entrada);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const id = randomUUID();
  const ahora = new Date();
  await conContexto(basePlataforma(ctx, id), async (consulta) => {
    await consulta.query(
      `insert into companies (
        id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at,
        operator_id, estado, demostracion, originada_por
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'prospecto', false, $9)`,
      [
        id,
        validada.valor.rfc,
        validada.valor.razonSocial,
        validada.valor.codigoPostal,
        validada.valor.regimen,
        validada.valor.usoCfdi,
        ahora,
        ctx.personal.operadorId,
        ctx.persona.id,
      ],
    );
    await auditar(consulta, actorDePersonal(ctx, id, "operacion"), {
      accion: "alta_empresa",
      identificador: id,
      cambio: { demostracion: false },
    });
    await consulta.query(
      `insert into company_state_history (
        id, operator_id, company_id, estado_anterior, estado_nuevo, actor_id, ocurrido_en
      ) values ($1, $2, $3, null, 'prospecto', $4, $5)`,
      [randomUUID(), ctx.personal.operadorId, id, ctx.persona.id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: id,
      accion: "prospecto_registrado",
      identificador: id,
      ocurridoEn: ahora,
    });
    await crearAlertaEnTransaccion(consulta, ctx, {
      companyId: id,
      categoria: "activacion",
      titulo: "Revisar activación para el portal",
      detalle: "La empresa es un prospecto. Solicita la activación y otra persona deberá decidirla.",
      responsableId: ctx.persona.id,
      ahora,
    });
  });
  return id;
}

export async function listarClientes(ctx: ContextoDePersonal): Promise<ClienteResumen[]> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select c.id, c.rfc, c.razon_social, c.estado, c.alta_at,
        r.id as solicitud_pendiente_id,
        (select u.nombre from memberships m
          join membership_roles mr on mr.company_id = m.company_id and mr.user_id = m.user_id and mr.rol = 'administrador'
          join users u on u.id = m.user_id
          where m.company_id = c.id order by m.alta_en, u.nombre limit 1) as administrador
       from companies c
       left join company_activation_requests r on r.company_id = c.id and r.estado = 'pendiente'
       order by c.alta_at desc, c.razon_social
       limit 300`,
      [],
    ),
  );
  return resultado.rows.map(mapearResumen);
}

export async function leerCliente(ctx: ContextoDePersonal, companyId: unknown): Promise<ClienteDetalle | null> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  if (!uuidValido(companyId)) return null;
  return conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    const empresa = await consulta.query(
      `select c.id, c.rfc, c.razon_social, c.codigo_postal, c.regimen, c.uso_cfdi,
        c.estado, c.alta_at, r.id as solicitud_pendiente_id,
        (select u.nombre from memberships m
          join membership_roles mr on mr.company_id = m.company_id and mr.user_id = m.user_id and mr.rol = 'administrador'
          join users u on u.id = m.user_id
          where m.company_id = c.id order by m.alta_en, u.nombre limit 1) as administrador,
        (select u.correo from memberships m
          join membership_roles mr on mr.company_id = m.company_id and mr.user_id = m.user_id and mr.rol = 'administrador'
          join users u on u.id = m.user_id
          where m.company_id = c.id order by m.alta_en, u.correo limit 1) as administrador_correo,
        (select m.estado from memberships m
          join membership_roles mr on mr.company_id = m.company_id and mr.user_id = m.user_id and mr.rol = 'administrador'
          where m.company_id = c.id order by m.alta_en, m.user_id limit 1) as administrador_estado,
        (select i.id from invitations i where i.company_id = c.id
          order by i.emitida_en desc, i.id desc limit 1) as ultima_invitacion_id
       from companies c
       left join company_activation_requests r on r.company_id = c.id and r.estado = 'pendiente'
       where c.id = $1`,
      [companyId],
    );
    const fila = empresa.rows[0];
    if (!fila) return null;
    const [historial, entregas] = await Promise.all([
      consulta.query(
        `select h.id, h.estado_anterior, h.estado_nuevo, h.ocurrido_en, u.nombre as actor
         from company_state_history h left join users u on u.id = h.actor_id
         where h.company_id = $1 order by h.ocurrido_en, h.id`,
        [companyId],
      ),
      consulta.query(
        "select id, estado, registrada_en, detalle from invitation_deliveries where company_id = $1 order by registrada_en desc",
        [companyId],
      ),
    ]);
    return {
      ...mapearResumen(fila),
      codigoPostal: String((fila as Record<string, unknown>).codigo_postal),
      regimen: String((fila as Record<string, unknown>).regimen),
      usoCfdi: String((fila as Record<string, unknown>).uso_cfdi),
      historial: (historial.rows as Array<Record<string, unknown>>).map((evento) => ({
        id: String(evento.id),
        estadoAnterior: evento.estado_anterior === null ? null : (evento.estado_anterior as EstadoCliente),
        estadoNuevo: evento.estado_nuevo as EstadoCliente,
        actor: typeof evento.actor === "string" ? evento.actor : "Sistema",
        ocurridoEn: fecha(evento.ocurrido_en),
      })),
      entregas: (entregas.rows as Array<Record<string, unknown>>).map((entrega) => ({
        id: String(entrega.id),
        estado: String(entrega.estado),
        registradaEn: fecha(entrega.registrada_en),
        detalle: typeof entrega.detalle === "string" ? entrega.detalle : null,
      })),
      ultimaInvitacionId:
        typeof (fila as Record<string, unknown>).ultima_invitacion_id === "string"
          ? String((fila as Record<string, unknown>).ultima_invitacion_id)
          : null,
    };
  });
}

function mapearResumen(valor: unknown): ClienteResumen {
  const fila = valor as Record<string, unknown>;
  return {
    id: String(fila.id),
    rfc: String(fila.rfc),
    razonSocial: String(fila.razon_social),
    estado: fila.estado as EstadoCliente,
    altaEn: fecha(fila.alta_at),
    solicitudPendienteId: typeof fila.solicitud_pendiente_id === "string" ? fila.solicitud_pendiente_id : null,
    administrador: typeof fila.administrador === "string" ? fila.administrador : null,
    administradorCorreo: typeof fila.administrador_correo === "string" ? fila.administrador_correo : null,
    administradorEstado:
      fila.administrador_estado === "activa" || fila.administrador_estado === "suspendida" || fila.administrador_estado === "invitada"
        ? fila.administrador_estado
        : null,
  };
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
