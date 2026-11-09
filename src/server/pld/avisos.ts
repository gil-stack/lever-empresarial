import { caracteresVisibles } from "../../dominio/control";
import { textoMultilinea, uuidValido } from "../../dominio/operacion";
import { TIPOS_AVISO, type TipoAviso } from "../../dominio/pld/etiquetas";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { unaVezPorFormulario } from "../operacion/formulario";
import { exigirEnOperacion } from "../operacion/permisos";
import { auditarPld } from "./auditar";
import { conPld, fecha } from "./base";

export type AcuseAviso = { id: string; folio: string; tipo: TipoAviso; recibidoEn: Date };

export type PersonaDelPersonal = { id: string; nombre: string };

/** Folio visible del acuse: las primeras ocho cifras del identificador, en mayúsculas. */
export function folioDeAviso(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** Las personas del personal que quien avisa puede excluir (persona mencionada o su superior). Sin ella misma. */
export async function personalParaExcluir(ctx: ContextoDePersonal): Promise<PersonaDelPersonal[]> {
  exigirEnOperacion(ctx, "plataforma.pld.aviso.emitir");
  return conPld(ctx, null, async (consulta) => {
    const filas = await consulta.query(
      `select u.id, u.nombre from platform_staff s join users u on u.id = s.user_id
       where s.operator_id = $1 and s.estado = 'activo' and s.user_id <> $2 order by u.nombre`,
      [ctx.personal.operadorId, ctx.persona.id],
    );
    return (filas.rows as Array<Record<string, unknown>>).map((fila) => ({ id: String(fila.id), nombre: String(fila.nombre) }));
  });
}

/**
 * 54ª fr. VIII y 60ª, último párrafo: cualquier persona del personal avisa al área
 * de Cumplimiento de forma confidencial. Quien avisa puede marcar a la persona
 * mencionada y a su superior jerárquico: la base no les deja ver el aviso, su
 * alerta ni su caso, aunque tengan rol de Cumplimiento. Quien avisa solo ve su acuse.
 */
export async function emitirAviso(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; tipo: unknown; descripcion: unknown; companyId: unknown; mencionada: unknown; superior: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<AcuseAviso> {
  exigirEnOperacion(ctx, "plataforma.pld.aviso.emitir");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (!(TIPOS_AVISO as readonly unknown[]).includes(entrada.tipo)) throw new ErrorDeDominio("dato_invalido_tipo");
  const descripcion = textoMultilinea(entrada.descripcion, 4000);
  // r2-fix2-N1: cuentan los caracteres que se ven, como en motivoEscrito; «Revisar» con 13 U+3164 son 7.
  if (!descripcion || caracteresVisibles(descripcion) < 20) throw new ErrorDeDominio("dato_invalido_descripcion");
  const companyId = entrada.companyId === "" || entrada.companyId === undefined || entrada.companyId === null ? null : entrada.companyId;
  if (companyId !== null && !uuidValido(companyId)) throw new ErrorDeDominio("dato_invalido_companyId");
  const excluir = (valor: unknown, campo: string): string | null => {
    if (valor === "" || valor === undefined || valor === null) return null;
    if (!uuidValido(valor)) throw new ErrorDeDominio(`dato_invalido_${campo}`);
    return valor;
  };
  const mencionada = excluir(entrada.mencionada, "mencionada");
  const superior = excluir(entrada.superior, "superior");
  if (mencionada && mencionada === superior) throw new ErrorDeDominio("dato_invalido_superior");
  const ahora = deps.ahora?.() ?? new Date();
  const id = entrada.formId;
  return unaVezPorFormulario(() => conPld(ctx, companyId, async (consulta) => {
    const previo = await consulta.query("select id, tipo, registrado_en from pld_avisos where id = $1", [id]);
    const fila = previo.rows[0] as { id?: string; tipo?: string; registrado_en?: unknown } | undefined;
    if (fila?.id) return { id: fila.id, folio: folioDeAviso(fila.id), tipo: fila.tipo as TipoAviso, recibidoEn: fecha(fila.registrado_en) };
    if (companyId) {
      const empresa = await consulta.query("select 1 from companies where id = $1", [companyId]);
      if (empresa.rows.length !== 1) throw new ErrorDeDominio("dato_invalido_companyId");
    }
    const insertado = await consulta.query(
      `insert into pld_avisos (id, operator_id, company_id, tipo, descripcion, registrado_por)
       values ($1, $2, $3, $4, $5, $6) returning registrado_en`,
      [id, ctx.personal.operadorId, companyId, entrada.tipo, descripcion, ctx.persona.id],
    );
    for (const [usuario, motivo] of [[mencionada, "mencionada"], [superior, "superior"]] as const) {
      if (!usuario) continue;
      await consulta.query("insert into pld_aviso_excluidos (aviso_id, user_id, operator_id, motivo) values ($1, $2, $3, $4)", [
        id, usuario, ctx.personal.operadorId, motivo,
      ]);
    }
    // El evento no lleva el texto ni a quién excluye: solo que hubo un aviso y de qué tipo.
    await auditarPld(consulta, ctx, {
      companyId, accion: "pld_aviso_emitido", identificador: id as string, ocurridoEn: ahora, cambio: { tipo: entrada.tipo as string },
    });
    return {
      id: id as string,
      folio: folioDeAviso(id as string),
      tipo: entrada.tipo as TipoAviso,
      recibidoEn: fecha((insertado.rows[0] as { registrado_en: unknown }).registrado_en),
    };
  }), "formulario_invalido");
}

/** Los acuses de quien avisa: folio, tipo y fecha. Nada del análisis. */
export async function misAcuses(ctx: ContextoDePersonal): Promise<AcuseAviso[]> {
  exigirEnOperacion(ctx, "plataforma.pld.aviso.emitir");
  return conPld(ctx, null, async (consulta) => {
    const filas = await consulta.query(
      "select id, tipo, registrado_en from pld_avisos where registrado_por = $1 order by registrado_en desc limit 50",
      [ctx.persona.id],
    );
    return (filas.rows as Array<Record<string, unknown>>).map((fila) => ({
      id: String(fila.id),
      folio: folioDeAviso(String(fila.id)),
      tipo: fila.tipo as TipoAviso,
      recibidoEn: fecha(fila.registrado_en),
    }));
  });
}
