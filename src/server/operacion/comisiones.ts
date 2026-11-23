import { randomUUID } from "node:crypto";

import {
  diaAnterior,
  hoyEnMexico,
  normalizarComision,
  uuidValido,
} from "../../dominio/operacion";
import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion";
import type { Sesion } from "../session/tipos";
import { auditarOperacion } from "./auditar";
import { cerrarAlertasDeCategoria, crearAlertaAutomatica } from "./alertas";
import type { Comision } from "./tipos";
import { motivoEscrito } from "./formulario";
import { exigirEnOperacion } from "./permisos";

export async function solicitarComision(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; tipo: unknown; valor: unknown; vigenteDesde: unknown },
): Promise<string> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  let normalizada: ReturnType<typeof normalizarComision>;
  try {
    normalizada = normalizarComision(entrada, hoyEnMexico(new Date()));
  } catch (error) {
    throw new ErrorDeDominio(error instanceof Error ? error.message : "comision_invalida");
  }
  const id = randomUUID();
  const ahora = new Date();
  await conContexto(basePlataforma(ctx, entrada.companyId), async (consulta) => {
    const empresa = await consulta.query("select estado from companies where id = $1 for update", [entrada.companyId]);
    const fila = empresa.rows[0] as { estado?: unknown } | undefined;
    if (!fila) throw new ErrorDeDominio("cliente_ausente");
    if (fila.estado !== "activa") throw new ErrorDeDominio("cliente_no_activo");
    await consulta.query("select pg_advisory_xact_lock(hashtextextended($1::text, 521))", [
      `${entrada.companyId}:${normalizada.tipo}`,
    ]);
    await consulta.query(
      `insert into company_commissions (
        id, operator_id, company_id, tipo, valor, moneda, vigente_desde, solicitada_por, solicitada_en
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        ctx.personal.operadorId,
        entrada.companyId,
        normalizada.tipo,
        normalizada.valor,
        normalizada.moneda,
        normalizada.vigenteDesde,
        ctx.persona.id,
        ahora,
      ],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: entrada.companyId as string,
      accion: "comision_solicitada",
      identificador: id,
      ocurridoEn: ahora,
    });
    await crearAlertaAutomatica(consulta, ctx, {
      companyId: entrada.companyId as string,
      categoria: "comision",
      titulo: `Autorizar comisión ${normalizada.tipo}`,
      detalle: `Versión propuesta con vigencia desde ${normalizada.vigenteDesde}. Requiere otra persona; no genera cargos.`,
      ahora,
    });
  });
  return id;
}

export async function decidirComision(
  ctx: ContextoDePersonal,
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  entrada: { id: unknown; aprobada: boolean; motivo?: unknown },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  exigirAutenticacionReciente(sesion);
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("comision_ausente");
  const motivo = entrada.aprobada ? null : motivoEscrito(entrada.motivo, 500);
  const ahora = new Date();
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const actual = await bloquearComision(consulta, entrada.id as string);
    if (actual.solicitadaPor === ctx.persona.id) throw new ErrorDeDominio("misma_persona_en_comision");
    await consulta.query("select pg_advisory_xact_lock(hashtextextended($1::text, 521))", [
      `${actual.companyId}:${actual.tipo}`,
    ]);
    if (entrada.aprobada) {
      const vigente = await consulta.query(
        `select id, vigente_desde from company_commissions
         where company_id = $1 and tipo = $2 and estado = 'vigente' for update`,
        [actual.companyId, actual.tipo],
      );
      const anterior = vigente.rows[0] as { id?: unknown; vigente_desde?: unknown } | undefined;
      if (anterior) {
        if (typeof anterior.id !== "string" || fechaDia(anterior.vigente_desde) >= actual.vigenteDesde) {
          throw new ErrorDeDominio("vigencia_solapada");
        }
        const cierre = diaAnterior(actual.vigenteDesde);
        await consulta.query(
          "update company_commissions set estado = 'cerrada', vigente_hasta = $2 where id = $1 and estado = 'vigente'",
          [anterior.id, cierre],
        );
        await auditarOperacion(consulta, ctx, {
          companyId: actual.companyId,
          accion: "comision_cerrada",
          identificador: anterior.id,
          motivo: `Sustituida por la versión ${actual.id}`,
          ocurridoEn: ahora,
        });
      }
    }
    const decidida = await consulta.query(
      `update company_commissions
       set estado = $2, decidida_por = $3, decidida_en = $4, motivo = $5
       where id = $1 and estado = 'pendiente'`,
      [actual.id, entrada.aprobada ? "vigente" : "rechazada", ctx.persona.id, ahora, motivo],
    );
    if (decidida.rowCount !== 1) throw new ErrorDeDominio("comision_ya_decidida");
    await auditarOperacion(consulta, ctx, {
      companyId: actual.companyId,
      accion: entrada.aprobada ? "comision_aprobada" : "comision_rechazada",
      identificador: actual.id,
      motivo,
      ocurridoEn: ahora,
    });
    await cerrarAlertasDeCategoria(
      consulta,
      ctx,
      actual.companyId,
      "comision",
      entrada.aprobada ? "Versión de comisión autorizada; no se generaron cargos." : `Versión rechazada: ${motivo}`,
      ahora,
    );
  });
}

export async function listarComisiones(ctx: ContextoDePersonal, companyId?: string): Promise<Comision[]> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select v.id, v.company_id, c.razon_social, v.tipo, v.valor, v.moneda,
        v.vigente_desde, v.vigente_hasta, v.estado, v.solicitada_por,
        solicitante.nombre as solicitante, v.solicitada_en,
        v.decidida_por, v.decidida_en, v.motivo
       from company_commissions v
       join companies c on c.id = v.company_id
       join users solicitante on solicitante.id = v.solicitada_por
       where ($1::uuid is null or v.company_id = $1)
       order by (v.estado = 'pendiente') desc, c.razon_social, v.tipo, v.vigente_desde desc
       limit 400`,
      [companyId ?? null],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    companyId: String(fila.company_id),
    razonSocial: String(fila.razon_social),
    tipo: fila.tipo === "spei" ? "spei" : "fondeo",
    valor: Number(fila.valor),
    moneda: fila.moneda === "MXN" ? "MXN" : null,
    vigenteDesde: fechaDia(fila.vigente_desde),
    vigenteHasta: fila.vigente_hasta ? fechaDia(fila.vigente_hasta) : null,
    estado: fila.estado as Comision["estado"],
    solicitadaPor: String(fila.solicitada_por),
    solicitante: String(fila.solicitante),
    solicitadaEn: fecha(fila.solicitada_en),
    decididaPor: typeof fila.decidida_por === "string" ? fila.decidida_por : null,
    decididaEn: fila.decidida_en ? fecha(fila.decidida_en) : null,
    motivo: typeof fila.motivo === "string" ? fila.motivo : null,
  }));
}

async function bloquearComision(consulta: Consulta, id: string) {
  const resultado = await consulta.query(
    `select id, company_id, tipo, vigente_desde, solicitada_por, estado
     from company_commissions where id = $1 for update`,
    [id],
  );
  const fila = resultado.rows[0] as Record<string, unknown> | undefined;
  if (!fila) throw new ErrorDeDominio("comision_ausente");
  if (fila.estado !== "pendiente") throw new ErrorDeDominio("comision_ya_decidida");
  return {
    id,
    companyId: String(fila.company_id),
    tipo: String(fila.tipo),
    vigenteDesde: fechaDia(fila.vigente_desde),
    solicitadaPor: String(fila.solicitada_por),
  };
}

function fechaDia(valor: unknown): string {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    // pg construye DATE a medianoche local. UTC lo movería al día anterior en
    // zonas positivas y también contaminaría el cálculo de la vigencia previa.
    const año = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${año}-${mes}-${dia}`;
  }
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  throw new ErrorDeDominio("base_no_disponible");
}

function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}
