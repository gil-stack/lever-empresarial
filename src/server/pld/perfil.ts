import { randomUUID } from "node:crypto";

import { leerCentavosEscritos } from "../../dominio/centavos";
import { hoyEnMexico, uuidValido, type Grado } from "../../dominio/operacion";
import { elegibleParaEvaluar, restarMeses, semestreAnterior, semestreDe, type Semestre } from "../../dominio/pld/plazos";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirEnOperacion } from "../operacion/permisos";
import { motivoEscrito, unaVezPorFormulario } from "../operacion/formulario";
import { auditarPld } from "./auditar";
import { conPld, dia, diaOpcional, fecha } from "./base";

export type PerfilTransaccional = {
  id: string;
  numero: number;
  origen: "declaracion" | "evaluacion" | "aprobacion";
  pagosMontoMensualCentavos: number;
  pagosOperacionesMensuales: number;
  nominaMontoMensualCentavos: number;
  nominaOperacionesMensuales: number;
  motivo: string | null;
  registradoPor: string;
  registradoEn: Date;
};

export type MontosDelPerfil = {
  pagosMonto: unknown;
  pagosOperaciones: unknown;
  nominaMonto: unknown;
  nominaOperaciones: unknown;
};

/** Pesos escritos (con centavos) a centavos enteros; vacío no es cero. */
function monto(valor: unknown, campo: string): number {
  const leido = leerCentavosEscritos(valor);
  if (leido.tipo !== "centavos") throw new ErrorDeDominio(`dato_invalido_${campo}`);
  return leido.centavos;
}

function operaciones(valor: unknown, campo: string): number {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!/^\d{1,7}$/.test(texto) || Number(texto) > 1_000_000) throw new ErrorDeDominio(`dato_invalido_${campo}`);
  return Number(texto);
}

export function leerMontos(entrada: MontosDelPerfil) {
  return {
    pagosMonto: monto(entrada.pagosMonto, "pagosMonto"),
    pagosOperaciones: operaciones(entrada.pagosOperaciones, "pagosOperaciones"),
    nominaMonto: monto(entrada.nominaMonto, "nominaMonto"),
    nominaOperaciones: operaciones(entrada.nominaOperaciones, "nominaOperaciones"),
  };
}

function aPerfil(fila: Record<string, unknown>): PerfilTransaccional {
  return {
    id: String(fila.id),
    numero: Number(fila.numero),
    origen: fila.origen === "evaluacion" ? "evaluacion" : fila.origen === "aprobacion" ? "aprobacion" : "declaracion",
    pagosMontoMensualCentavos: Number(fila.pagos_monto_mensual_centavos),
    pagosOperacionesMensuales: Number(fila.pagos_operaciones_mensuales),
    nominaMontoMensualCentavos: Number(fila.nomina_monto_mensual_centavos),
    nominaOperacionesMensuales: Number(fila.nomina_operaciones_mensuales),
    motivo: typeof fila.motivo === "string" ? fila.motivo : null,
    registradoPor: String(fila.nombre),
    registradoEn: fecha(fila.registrado_en),
  };
}

/** Las versiones del perfil, la vigente primero. La ven quienes ven el expediente. */
export async function leerPerfiles(ctx: ContextoDePersonal, companyId: unknown): Promise<PerfilTransaccional[]> {
  exigirEnOperacion(ctx, "plataforma.expediente.ver");
  if (!uuidValido(companyId)) return [];
  return conPld(ctx, companyId, async (consulta) => {
    const filas = await consulta.query(
      `select p.*, u.nombre from pld_perfiles p join users u on u.id = p.registrado_por
       where p.company_id = $1 order by p.numero desc`,
      [companyId],
    );
    return (filas.rows as Array<Record<string, unknown>>).map(aPerfil);
  });
}

/** Un cambio de perfil que pidió Originación con la empresa ya activa, y cómo lo resolvió Cumplimiento. */
export type PropuestaDePerfil = {
  id: string;
  pagosMontoMensualCentavos: number;
  pagosOperacionesMensuales: number;
  nominaMontoMensualCentavos: number;
  nominaOperacionesMensuales: number;
  motivo: string;
  propuestaPor: string;
  propuestaEn: Date;
  resolucion: { decision: "aprobada" | "rechazada"; motivo: string; por: string; en: Date } | null;
};

/** Las propuestas de la empresa, la más reciente primero (a lo más 5). La pendiente, si hay, es la primera. */
export async function leerPropuestasDePerfil(ctx: ContextoDePersonal, companyId: unknown): Promise<PropuestaDePerfil[]> {
  exigirEnOperacion(ctx, "plataforma.expediente.ver");
  if (!uuidValido(companyId)) return [];
  return conPld(ctx, companyId, async (consulta) => {
    const filas = await consulta.query(
      `select x.*, u.nombre, r.decision, r.motivo as motivo_resolucion, r.registrado_en as resuelta_en, v.nombre as resuelta_por
       from pld_perfil_propuestas x
       join users u on u.id = x.registrado_por
       left join pld_perfil_resoluciones r on r.propuesta_id = x.id
       left join users v on v.id = r.registrado_por
       where x.company_id = $1
       order by x.registrado_en desc limit 5`,
      [companyId],
    );
    return (filas.rows as Array<Record<string, unknown>>).map((fila) => ({
      id: String(fila.id),
      pagosMontoMensualCentavos: Number(fila.pagos_monto_mensual_centavos),
      pagosOperacionesMensuales: Number(fila.pagos_operaciones_mensuales),
      nominaMontoMensualCentavos: Number(fila.nomina_monto_mensual_centavos),
      nominaOperacionesMensuales: Number(fila.nomina_operaciones_mensuales),
      motivo: String(fila.motivo),
      propuestaPor: String(fila.nombre),
      propuestaEn: fecha(fila.registrado_en),
      resolucion: fila.decision === "aprobada" || fila.decision === "rechazada"
        ? { decision: fila.decision, motivo: String(fila.motivo_resolucion), por: String(fila.resuelta_por), en: fecha(fila.resuelta_en) }
        : null,
    }));
  });
}

/**
 * 25ª y 26ª: Originación declara el perfil transaccional dentro del expediente. Cada
 * declaración es una versión nueva; cambiar uno ya declarado pide motivo.
 *
 * r2-base-N18 (decisión del líder): con la empresa activa o suspendida, lo que
 * captura Originación es una propuesta. El perfil vigente (el umbral de «Excede el
 * perfil») no cambia hasta que Cumplimiento la aprueba.
 */
export async function declararPerfil(
  ctx: ContextoDePersonal,
  entrada: MontosDelPerfil & { companyId: unknown; formId: unknown; motivo: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<"declarado" | "propuesto"> {
  exigirEnOperacion(ctx, "plataforma.expediente.capturar");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const montos = leerMontos(entrada);
  // Barrido del motivo largo: todo motivo que va a la bitácora (audit_log.motivo) tiene tope de 500, entero y sin
  // recortar. En la primera declaración el motivo es opcional, pero si viene se revisa: uno de más no se descarta.
  const escrito = typeof entrada.motivo === "string" && entrada.motivo.trim() ? motivoEscrito(entrada.motivo, 500) : null;
  const companyId = entrada.companyId;
  const ahora = deps.ahora?.() ?? new Date();
  let resultado: "declarado" | "propuesto" = "declarado";
  await unaVezPorFormulario(() => conPld(ctx, companyId, async (consulta) => {
    const previo = await consulta.query("select company_id from pld_perfiles where id = $1", [entrada.formId]);
    const previaPropuesta = await consulta.query("select company_id from pld_perfil_propuestas where id = $1", [entrada.formId]);
    const ya = (previo.rows[0] ?? previaPropuesta.rows[0]) as { company_id: string } | undefined;
    if (ya) {
      if (ya.company_id !== companyId) throw new ErrorDeDominio("cliente_ausente");
      resultado = previaPropuesta.rows.length > 0 ? "propuesto" : "declarado";
      return;
    }
    const empresa = (await consulta.query("select estado from companies where id = $1", [companyId])).rows[0] as { estado?: string } | undefined;
    if (!empresa) throw new ErrorDeDominio("cliente_ausente");
    if (empresa.estado === "activa" || empresa.estado === "suspendida") {
      const motivo = motivoEscrito(entrada.motivo, 500);
      await consulta.query(
        `insert into pld_perfil_propuestas (
           id, operator_id, company_id, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
           nomina_monto_mensual_centavos, nomina_operaciones_mensuales, motivo, registrado_por
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entrada.formId, ctx.personal.operadorId, companyId, montos.pagosMonto, montos.pagosOperaciones,
          montos.nominaMonto, montos.nominaOperaciones, motivo, ctx.persona.id],
      );
      await auditarPld(consulta, ctx, {
        companyId, accion: "expediente_perfil_propuesto", identificador: entrada.formId as string, motivo, ocurridoEn: ahora,
      });
      resultado = "propuesto";
      return;
    }
    const hay = await consulta.query("select 1 from pld_perfiles where company_id = $1 limit 1", [companyId]);
    const motivo = hay.rows.length > 0 ? motivoEscrito(entrada.motivo, 500) : escrito;
    await consulta.query(
      `insert into pld_perfiles (
         id, operator_id, company_id, origen, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
         nomina_monto_mensual_centavos, nomina_operaciones_mensuales, motivo, registrado_por
       ) values ($1, $2, $3, 'declaracion', $4, $5, $6, $7, $8, $9)`,
      [entrada.formId, ctx.personal.operadorId, companyId, montos.pagosMonto, montos.pagosOperaciones,
        montos.nominaMonto, montos.nominaOperaciones, motivo, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, {
      companyId, accion: "expediente_perfil_declarado", identificador: entrada.formId as string, motivo, ocurridoEn: ahora,
    });
  }), "cliente_ausente");
  return resultado;
}

/**
 * r2-base-N18: Cumplimiento aprueba o rechaza, con motivo, la propuesta pendiente.
 * Aprobada, sus montos quedan como la versión vigente en la misma transacción (la
 * base los copia de la propuesta, no de lo que mande la pantalla).
 */
export async function resolverPropuestaDePerfil(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; propuestaId: unknown; decision: unknown; motivo: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<"aprobada" | "rechazada"> {
  exigirEnOperacion(ctx, "plataforma.riesgo.calificar");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  if (!uuidValido(entrada.propuestaId)) throw new ErrorDeDominio("propuesta_de_perfil_no_pendiente");
  if (entrada.decision !== "aprobada" && entrada.decision !== "rechazada") throw new ErrorDeDominio("dato_invalido_decision");
  const decision = entrada.decision;
  const motivo = motivoEscrito(entrada.motivo, 500);
  const companyId = entrada.companyId;
  const ahora = deps.ahora?.() ?? new Date();
  await conPld(ctx, companyId, async (consulta) => {
    const propuesta = (await consulta.query("select company_id from pld_perfil_propuestas where id = $1", [entrada.propuestaId])).rows[0] as
      | { company_id: string }
      | undefined;
    if (!propuesta || propuesta.company_id !== companyId) throw new ErrorDeDominio("propuesta_de_perfil_no_pendiente");
    // Doble clic de la misma decisión: ya quedó.
    const ya = (await consulta.query("select decision, registrado_por from pld_perfil_resoluciones where propuesta_id = $1", [entrada.propuestaId])).rows[0] as
      | { decision: string; registrado_por: string }
      | undefined;
    if (ya) {
      if (ya.decision === decision && ya.registrado_por === ctx.persona.id) return;
      throw new ErrorDeDominio("propuesta_de_perfil_no_pendiente");
    }
    let perfilId: string | null = null;
    if (decision === "aprobada") {
      perfilId = randomUUID();
      await consulta.query(
        `insert into pld_perfiles (
           id, operator_id, company_id, origen, propuesta_id, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
           nomina_monto_mensual_centavos, nomina_operaciones_mensuales, registrado_por
         ) values ($1, $2, $3, 'aprobacion', $4, 0, 0, 0, 0, $5)`,
        [perfilId, ctx.personal.operadorId, companyId, entrada.propuestaId, ctx.persona.id],
      );
      await auditarPld(consulta, ctx, {
        companyId, accion: "pld_perfil_actualizado", identificador: perfilId, ocurridoEn: ahora, cambio: { origen: "aprobacion" },
      });
    }
    await consulta.query(
      `insert into pld_perfil_resoluciones (propuesta_id, operator_id, company_id, decision, perfil_id, motivo, registrado_por)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [entrada.propuestaId, ctx.personal.operadorId, companyId, decision, perfilId, motivo, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, {
      companyId, accion: decision === "aprobada" ? "expediente_perfil_aprobado" : "expediente_perfil_rechazado",
      identificador: entrada.propuestaId as string, motivo, ocurridoEn: ahora,
    });
  });
  return decision;
}

export type EvaluacionPendiente = {
  companyId: string;
  razonSocial: string;
  celebracion: string;
  semestre: Semestre;
  vence: string;
  /** El semestre anterior también debía tener evaluación y no la tiene. */
  anteriorFaltante: boolean;
  ultimaEvaluacion: string | null;
};

/**
 * 27ª: dos evaluaciones por año calendario, una por semestre, para cada cliente
 * que celebró su contrato al menos seis meses antes. Se calcula al leer, sin tarea
 * programada. La celebración la define pld_celebracion_contrato (0030). Las empresas
 * de demostración no entran a PLD (C).
 */
export async function leerEvaluacionesPendientes(ctx: ContextoDePersonal, opciones: { ahora?: Date } = {}): Promise<EvaluacionPendiente[]> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  const hoy = hoyEnMexico(opciones.ahora ?? new Date());
  const actual = semestreDe(hoy);
  const anterior = semestreAnterior(actual);
  return conPld(ctx, null, async (consulta) => {
    const filas = await consulta.query(
      `select c.id, c.razon_social, pld_celebracion_contrato(c.id)::text as celebracion,
              (select max(e.evaluada_el)::text from pld_evaluaciones e where e.company_id = c.id) as ultima,
              exists (select 1 from pld_evaluaciones e where e.company_id = c.id and e.anio = $1 and e.semestre = $2) as actual,
              exists (select 1 from pld_evaluaciones e where e.company_id = c.id and e.anio = $3 and e.semestre = $4) as anterior
       from companies c
       where c.estado in ('activa', 'suspendida') and not c.demostracion
       order by c.razon_social`,
      [actual.anio, actual.semestre, anterior.anio, anterior.semestre],
    );
    const salida: EvaluacionPendiente[] = [];
    for (const fila of filas.rows as Array<Record<string, unknown>>) {
      const celebracion = diaOpcional(fila.celebracion);
      // Pendiente del semestre en curso: ya cumple seis meses hoy y no hay evaluación en el semestre.
      if (!elegibleParaEvaluar(celebracion, hoy) || fila.actual === true) continue;
      salida.push({
        companyId: String(fila.id),
        razonSocial: String(fila.razon_social),
        celebracion: celebracion!,
        semestre: actual,
        vence: actual.fin,
        anteriorFaltante: fila.anterior !== true && elegibleParaEvaluar(celebracion, anterior.fin),
        ultimaEvaluacion: diaOpcional(fila.ultima),
      });
    }
    return salida;
  });
}

export type Evaluacion = {
  id: string;
  anio: number;
  semestre: 1 | 2;
  perfil: "mantiene" | "cambia";
  grado: Grado;
  justificacion: string;
  evaluadaEl: string;
  registradoPor: string;
};

export async function leerEvaluaciones(ctx: ContextoDePersonal, companyId: unknown): Promise<Evaluacion[]> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (!uuidValido(companyId)) return [];
  return conPld(ctx, companyId, async (consulta) => {
    const filas = await consulta.query(
      `select e.id, e.anio, e.semestre, e.perfil, e.grado, e.justificacion, e.evaluada_el::text as evaluada_el, u.nombre
       from pld_evaluaciones e join users u on u.id = e.registrado_por
       where e.company_id = $1 order by e.evaluada_el desc, e.registrado_en desc`,
      [companyId],
    );
    return (filas.rows as Array<Record<string, unknown>>).map((fila) => ({
      id: String(fila.id),
      anio: Number(fila.anio),
      semestre: Number(fila.semestre) === 2 ? 2 : 1,
      perfil: fila.perfil === "cambia" ? "cambia" : "mantiene",
      grado: String(fila.grado) as Grado,
      justificacion: String(fila.justificacion),
      evaluadaEl: dia(fila.evaluada_el),
      registradoPor: String(fila.nombre),
    }));
  });
}

/**
 * 27ª: Cumplimiento registra la evaluación semestral. Mantiene el perfil o lo
 * cambia (una versión nueva en la misma transacción) y liga la calificación de
 * riesgo vigente; cambiar el grado se hace antes con la calificación de la 0028.
 */
export async function registrarEvaluacion(
  ctx: ContextoDePersonal,
  entrada: Partial<MontosDelPerfil> & { companyId: unknown; formId: unknown; perfil: unknown; justificacion: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.riesgo.calificar");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (entrada.perfil !== "mantiene" && entrada.perfil !== "cambia") throw new ErrorDeDominio("dato_invalido_perfil");
  const cambia = entrada.perfil === "cambia";
  const montos = cambia
    ? leerMontos({
        pagosMonto: entrada.pagosMonto, pagosOperaciones: entrada.pagosOperaciones,
        nominaMonto: entrada.nominaMonto, nominaOperaciones: entrada.nominaOperaciones,
      })
    : null;
  const justificacion = motivoEscrito(entrada.justificacion, 2000);
  const companyId = entrada.companyId;
  const ahora = deps.ahora?.() ?? new Date();
  await unaVezPorFormulario(() => conPld(ctx, companyId, async (consulta) => {
    const previo = await consulta.query("select company_id from pld_evaluaciones where id = $1", [entrada.formId]);
    if (previo.rows.length > 0) {
      if ((previo.rows[0] as { company_id: string }).company_id !== companyId) throw new ErrorDeDominio("cliente_ausente");
      return;
    }
    const calificacion = await consulta.query(
      "select id from kyb_calificaciones_riesgo where company_id = $1 order by calificada_en desc, id desc limit 1",
      [companyId],
    );
    const calificacionId = (calificacion.rows[0] as { id?: string } | undefined)?.id;
    if (!calificacionId) throw new ErrorDeDominio("calificacion_sin_expediente");
    let perfilId: string;
    if (montos) {
      perfilId = randomUUID();
      await consulta.query(
        `insert into pld_perfiles (
           id, operator_id, company_id, origen, pagos_monto_mensual_centavos, pagos_operaciones_mensuales,
           nomina_monto_mensual_centavos, nomina_operaciones_mensuales, motivo, registrado_por
         ) values ($1, $2, $3, 'evaluacion', $4, $5, $6, $7, $8, $9)`,
        [perfilId, ctx.personal.operadorId, companyId, montos.pagosMonto, montos.pagosOperaciones, montos.nominaMonto,
          montos.nominaOperaciones, justificacion, ctx.persona.id],
      );
      await auditarPld(consulta, ctx, {
        companyId, accion: "pld_perfil_actualizado", identificador: perfilId, ocurridoEn: ahora, cambio: { origen: "evaluacion" },
      });
    } else {
      const vigente = await consulta.query("select id from pld_perfiles where company_id = $1 order by numero desc limit 1", [companyId]);
      const id = (vigente.rows[0] as { id?: string } | undefined)?.id;
      if (!id) throw new ErrorDeDominio("evaluacion_sin_perfil");
      perfilId = id;
    }
    await consulta.query(
      `insert into pld_evaluaciones (id, operator_id, company_id, perfil, perfil_id, calificacion_id, justificacion, registrado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entrada.formId, ctx.personal.operadorId, companyId, entrada.perfil, perfilId, calificacionId, justificacion, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, {
      companyId, accion: "pld_evaluacion_registrada", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { perfil: entrada.perfil as string },
    });
  }), "cliente_ausente");
}

/** Para la pantalla: desde qué fecha un cliente queda cubierto por la 27ª. */
export function cubiertoDesde(celebracion: string): string {
  return restarMeses(celebracion, -6);
}
