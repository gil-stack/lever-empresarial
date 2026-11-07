import { randomUUID } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { textoMultilinea, textoOperativo, uuidValido } from "../../dominio/operacion";
import { auditarOperacion } from "./auditar";
import type { AlertaOperativa } from "./tipos";
import { exigirEnOperacion } from "./permisos";

export async function crearAlertaEnTransaccion(
  consulta: Consulta,
  ctx: ContextoDePersonal,
  entrada: {
    id?: string;
    companyId: string;
    categoria: AlertaOperativa["categoria"];
    titulo: string;
    detalle: string;
    responsableId: string;
    ahora: Date;
  },
): Promise<string> {
  const id = entrada.id ?? randomUUID();
  await consulta.query(
    `insert into operational_alerts (
      id, operator_id, company_id, categoria, titulo, detalle,
      responsable_id, creada_por, creada_en
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      ctx.personal.operadorId,
      entrada.companyId,
      entrada.categoria,
      entrada.titulo,
      entrada.detalle,
      entrada.responsableId,
      ctx.persona.id,
      entrada.ahora,
    ],
  );
  await auditarOperacion(consulta, ctx, {
    companyId: entrada.companyId,
    accion: "alerta_creada",
    identificador: id,
    ocurridoEn: entrada.ahora,
  });
  return id;
}

export async function listarAlertas(ctx: ContextoDePersonal, companyId?: string): Promise<AlertaOperativa[]> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select a.id, a.company_id, c.razon_social, a.categoria, a.titulo, a.detalle,
        a.responsable_id, responsable.nombre as responsable, a.creada_en, a.estado,
        cerrador.nombre as cerrada_por, a.cerrada_en, a.motivo_cierre
       from operational_alerts a
       join companies c on c.id = a.company_id
       join users responsable on responsable.id = a.responsable_id
       left join users cerrador on cerrador.id = a.cerrada_por
       where ($1::uuid is null or a.company_id = $1)
       order by (a.estado = 'abierta') desc, a.creada_en desc
       limit 300`,
      [companyId ?? null],
    ),
  );
  return resultado.rows.map(mapearAlerta);
}

export async function crearAlerta(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; titulo: unknown; detalle: unknown; responsableId: unknown },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  if (!uuidValido(entrada.companyId) || !uuidValido(entrada.responsableId)) throw new ErrorDeDominio("alerta_invalida");
  const titulo = textoOperativo(entrada.titulo, 160);
  const detalle = textoMultilinea(entrada.detalle, 500);
  if (!titulo || !detalle) throw new ErrorDeDominio("alerta_invalida");
  const ahora = new Date();
  await conContexto(basePlataforma(ctx, entrada.companyId), async (consulta) => {
    await exigirEmpresa(consulta, entrada.companyId as string);
    await exigirResponsable(consulta, ctx, entrada.responsableId as string);
    await crearAlertaEnTransaccion(consulta, ctx, {
      companyId: entrada.companyId as string,
      categoria: "operativa",
      titulo,
      detalle,
      responsableId: entrada.responsableId as string,
      ahora,
    });
  });
}

export async function asignarAlerta(ctx: ContextoDePersonal, id: unknown, responsableId: unknown): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  if (!uuidValido(id) || !uuidValido(responsableId)) throw new ErrorDeDominio("alerta_invalida");
  const ahora = new Date();
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const alerta = await bloquearAlerta(consulta, id);
    await exigirResponsable(consulta, ctx, responsableId);
    await consulta.query("update operational_alerts set responsable_id = $2 where id = $1 and estado = 'abierta'", [
      id,
      responsableId,
    ]);
    await auditarOperacion(consulta, ctx, {
      companyId: alerta.companyId,
      accion: "alerta_asignada",
      identificador: id,
      ocurridoEn: ahora,
    });
  });
}

export async function cerrarAlerta(ctx: ContextoDePersonal, id: unknown, motivo: unknown): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  if (!uuidValido(id)) throw new ErrorDeDominio("alerta_ausente");
  const limpio = textoMultilinea(motivo, 500);
  if (!limpio) throw new ErrorDeDominio("motivo_invalido");
  await conContexto(basePlataforma(ctx), async (consulta) => {
    await cerrarAlertaEnTransaccion(consulta, ctx, id, limpio, new Date());
  });
}

export async function cerrarAlertasDeCategoria(
  consulta: Consulta,
  ctx: ContextoDePersonal,
  companyId: string,
  categoria: AlertaOperativa["categoria"],
  motivo: string,
  ahora: Date,
): Promise<void> {
  const abiertas = await consulta.query(
    "select id from operational_alerts where company_id = $1 and categoria = $2 and estado = 'abierta' for update",
    [companyId, categoria],
  );
  for (const fila of abiertas.rows as Array<{ id?: unknown }>) {
    if (typeof fila.id === "string") await cerrarAlertaEnTransaccion(consulta, ctx, fila.id, motivo, ahora);
  }
}

async function cerrarAlertaEnTransaccion(
  consulta: Consulta,
  ctx: ContextoDePersonal,
  id: string,
  motivo: string,
  ahora: Date,
): Promise<void> {
  const alerta = await bloquearAlerta(consulta, id);
  const cerrada = await consulta.query(
    `update operational_alerts set estado = 'cerrada', cerrada_por = $2, cerrada_en = $3, motivo_cierre = $4
     where id = $1 and estado = 'abierta'`,
    [id, ctx.persona.id, ahora, motivo],
  );
  if (cerrada.rowCount !== 1) throw new ErrorDeDominio("alerta_ya_cerrada");
  await auditarOperacion(consulta, ctx, {
    companyId: alerta.companyId,
    accion: "alerta_cerrada",
    identificador: id,
    motivo,
    ocurridoEn: ahora,
  });
}

async function bloquearAlerta(consulta: Consulta, id: string): Promise<{ companyId: string }> {
  const resultado = await consulta.query(
    "select company_id, estado from operational_alerts where id = $1 for update",
    [id],
  );
  const fila = resultado.rows[0] as { company_id?: unknown; estado?: unknown } | undefined;
  if (!fila || typeof fila.company_id !== "string") throw new ErrorDeDominio("alerta_ausente");
  if (fila.estado !== "abierta") throw new ErrorDeDominio("alerta_ya_cerrada");
  return { companyId: fila.company_id };
}

async function exigirEmpresa(consulta: Consulta, companyId: string): Promise<void> {
  const empresa = await consulta.query("select id from companies where id = $1", [companyId]);
  if (empresa.rows.length !== 1) throw new ErrorDeDominio("cliente_ausente");
}

async function exigirResponsable(consulta: Consulta, ctx: ContextoDePersonal, userId: string): Promise<void> {
  const responsable = await consulta.query(
    "select user_id from platform_staff where operator_id = $1 and user_id = $2 and estado = 'activo'",
    [ctx.personal.operadorId, userId],
  );
  if (responsable.rows.length !== 1) throw new ErrorDeDominio("responsable_invalido");
}

function mapearAlerta(valor: unknown): AlertaOperativa {
  const fila = valor as Record<string, unknown>;
  return {
    id: String(fila.id),
    companyId: String(fila.company_id),
    razonSocial: String(fila.razon_social),
    categoria: fila.categoria as AlertaOperativa["categoria"],
    titulo: String(fila.titulo),
    detalle: String(fila.detalle),
    responsableId: String(fila.responsable_id),
    responsable: String(fila.responsable),
    creadaEn: fecha(fila.creada_en),
    estado: fila.estado === "cerrada" ? "cerrada" : "abierta",
    cerradaPor: typeof fila.cerrada_por === "string" ? fila.cerrada_por : null,
    cerradaEn: fila.cerrada_en ? fecha(fila.cerrada_en) : null,
    motivoCierre: typeof fila.motivo_cierre === "string" ? fila.motivo_cierre : null,
  };
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
