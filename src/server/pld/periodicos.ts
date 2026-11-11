import { createHash } from "node:crypto";

import { hoyEnMexico, textoOperativo, uuidValido } from "../../dominio/operacion";
import { claveCasfimValida, relevantesVacio } from "../../dominio/pld/layout41";
import {
  inicioDelPeriodo,
  mesAnterior,
  mesDe,
  mesSiguiente,
  nombreMes,
  nombreTrimestre,
  trimestreAnterior,
  trimestreDe,
} from "../../dominio/pld/plazos";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { unaVezPorFormulario } from "../operacion/formulario";
import { exigirEnOperacion } from "../operacion/permisos";
import { auditarPld } from "./auditar";
import { conPld, dia, fecha, rechazarInvisible } from "./base";
import { leerFechaHora } from "./comite";

/**
 * Los tipos de operación que vigila PLD (CHECK pld_operaciones_tipo, 0030). Ninguno
 * es en efectivo ni internacional: por eso la 36ª sale en ceros y la 38ª es una
 * constancia en ceros. Si la base agrega un tipo, la prueba de los reportes
 * periódicos truena hasta que se clasifique aquí y se actualicen los reportes.
 */
export const TIPOS_DE_OPERACION = ["pago_proveedor", "nomina"] as const;
/** 2ª fr. XXXI y 36ª: operaciones relevantes son en efectivo. Hoy Lever no tiene ninguna. */
export const TIPOS_EN_EFECTIVO: readonly string[] = [];
/** 38ª: transferencias internacionales. Hoy Lever no tiene ninguna (los pagos internacionales son demo). */
export const TIPOS_INTERNACIONALES: readonly string[] = [];

export type Entidad = { claveCasfim: string; claveOrganoSupervisor: string; registradaEn: Date };

export async function leerEntidad(ctx: ContextoDePersonal): Promise<Entidad | null> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  return conPld(ctx, null, async (consulta) => {
    const fila = (await consulta.query(
      "select clave_casfim, clave_organo_supervisor, registrado_en from pld_entidad where operator_id = $1 order by registrado_en desc, id desc limit 1",
      [ctx.personal.operadorId],
    )).rows[0] as Record<string, unknown> | undefined;
    return fila
      ? { claveCasfim: String(fila.clave_casfim), claveOrganoSupervisor: String(fila.clave_organo_supervisor), registradaEn: fecha(fila.registrado_en) }
      : null;
  });
}

/**
 * Columnas 4 y 5 del formato oficial: claves CASFIM de 6 dígitos del órgano
 * supervisor y de la entidad (se consultan en el catálogo «Instituciones» del
 * SITI). Lever nunca guarda la clave de acceso al SITI del Oficial (72ª-1).
 */
export async function registrarEntidad(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; claveCasfim: unknown; claveOrganoSupervisor: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.reportar");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const clave = typeof entrada.claveCasfim === "string" ? entrada.claveCasfim.trim() : "";
  const organo = typeof entrada.claveOrganoSupervisor === "string" ? entrada.claveOrganoSupervisor.trim() : "";
  if (!claveCasfimValida(clave)) throw new ErrorDeDominio("dato_invalido_claveCasfim");
  if (!claveCasfimValida(organo)) throw new ErrorDeDominio("dato_invalido_claveOrganoSupervisor");
  const ahora = deps.ahora?.() ?? new Date();
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_entidad where id = $1", [entrada.formId])).rows.length > 0) return;
    await consulta.query(
      "insert into pld_entidad (id, operator_id, clave_casfim, clave_organo_supervisor, registrado_por) values ($1, $2, $3, $4, $5)",
      [entrada.formId, ctx.personal.operadorId, clave, organo, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, { companyId: null, accion: "pld_entidad_registrada", identificador: entrada.formId as string, ocurridoEn: ahora });
  }), "formulario_invalido");
}

export type Periodico = {
  reporte: "36" | "38";
  periodo: string;
  nombre: string;
  vence: string;
  estado: "registrado" | "por_vencer" | "vencido";
  /** El periodo ya cerró: solo entonces se genera su archivo y se registra (la base lo exige). */
  cerrado: boolean;
  /** Días hábiles que quedan hasta el vencimiento (0 si ya pasó). */
  diasHabiles: number;
  registro: { folio: string | null; recibidoEn: Date | null; sha256: string; registradoEn: Date } | null;
  /** Algún año del cálculo no tiene sus dos calendarios de días inhábiles: solo se descuentan fines de semana. */
  faltaCalendario: number | null;
};

async function vencimientos(consulta: Consulta, hoy: string, periodos: Array<{ reporte: "36" | "38"; periodo: string }>) {
  const filas = (await consulta.query(
    `select p.reporte, p.periodo,
            (case when p.reporte = '36' then pld_dia_habil_del_mes(p.mes_entrega::date, 10)
                  else pld_sumar_dias_habiles(pld_ultimo_dia_habil(p.mes_periodo::date), 15) end)::text as vence
     from jsonb_to_recordset($1::jsonb) as p (reporte text, periodo text, mes_entrega text, mes_periodo text)`,
    [JSON.stringify(periodos.map((p) => ({ ...p, mes_entrega: mesSiguiente(p.periodo), mes_periodo: inicioDelPeriodo(p.periodo) })))],
  )).rows as Array<{ reporte: "36" | "38"; periodo: string; vence: string }>;
  const resultado: Array<{ reporte: "36" | "38"; periodo: string; vence: string; diasHabiles: number; faltaCalendario: number | null }> = [];
  for (const fila of filas) {
    const vence = dia(fila.vence);
    const extra = (await consulta.query(
      `select pld_dias_habiles_entre($1::date, $2::date) as dias,
              (select min(a) from unnest(array[extract(year from $1::date)::int, extract(year from $2::date)::int, extract(year from $3::date)::int]) as a
               where not pld_calendario_cargado(a)) as falta`,
      [hoy, vence, inicioDelPeriodo(fila.periodo)],
    )).rows[0] as { dias: number; falta: number | null };
    resultado.push({ ...fila, vence, diasHabiles: Number(extra.dias), faltaCalendario: extra.falta === null ? null : Number(extra.falta) });
  }
  return resultado;
}

/**
 * Lo que toca presentar: la 36ª del trimestre anterior y la del trimestre en
 * curso (primeros 10 días hábiles de enero, abril, julio y octubre) y la
 * constancia de la 38ª de los dos meses anteriores (15 días hábiles después del
 * último día hábil del mes). Se calcula al leer.
 */
export async function leerPeriodicos(ctx: ContextoDePersonal, opciones: { ahora?: Date } = {}): Promise<Periodico[]> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  const hoy = hoyEnMexico(opciones.ahora ?? new Date());
  const trimestre = trimestreDe(hoy);
  const mes = mesDe(hoy);
  const periodos: Array<{ reporte: "36" | "38"; periodo: string }> = [
    { reporte: "36", periodo: trimestreAnterior(trimestre) },
    { reporte: "36", periodo: trimestre },
    { reporte: "38", periodo: mesAnterior(mesAnterior(mes)) },
    { reporte: "38", periodo: mesAnterior(mes) },
  ];
  return conPld(ctx, null, async (consulta) => {
    const plazos = await vencimientos(consulta, hoy, periodos);
    const registros = (await consulta.query(
      "select reporte, periodo, folio, recibido_en, archivo_sha256, registrado_en from pld_periodicos where operator_id = $1 and periodo = any($2::text[])",
      [ctx.personal.operadorId, periodos.map((p) => p.periodo)],
    )).rows as Array<Record<string, unknown>>;
    return plazos.map((plazo): Periodico => {
      const registro = registros.find((r) => r.reporte === plazo.reporte && r.periodo === plazo.periodo);
      return {
        reporte: plazo.reporte,
        periodo: plazo.periodo,
        nombre: plazo.reporte === "36" ? `Relevantes de ${nombreTrimestre(plazo.periodo)}` : `Transferencias internacionales de ${nombreMes(plazo.periodo)}`,
        vence: plazo.vence,
        estado: registro ? "registrado" : plazo.vence < hoy ? "vencido" : "por_vencer",
        cerrado: hoy >= mesSiguiente(plazo.periodo),
        diasHabiles: plazo.diasHabiles,
        registro: registro
          ? {
              folio: typeof registro.folio === "string" ? registro.folio : null,
              recibidoEn: registro.recibido_en ? fecha(registro.recibido_en) : null,
              sha256: String(registro.archivo_sha256),
              registradoEn: fecha(registro.registrado_en),
            }
          : null,
        faltaCalendario: plazo.faltaCalendario,
      };
    });
  });
}

async function operacionesDeTipos(consulta: Consulta, operador: string, tipos: readonly string[], desde: string, hasta: string): Promise<number> {
  if (tipos.length === 0) return 0;
  const fila = (await consulta.query(
    `select count(*)::int as total from pld_operaciones where operator_id = $1 and tipo = any($2::text[])
     and ocurrida_en >= ($3::date)::timestamp at time zone 'America/Mexico_City' and ocurrida_en < ($4::date)::timestamp at time zone 'America/Mexico_City'`,
    [operador, tipos, desde, hasta],
  )).rows[0] as { total: number };
  return Number(fila.total);
}

/**
 * 36ª: el archivo del trimestre con el layout de 41 columnas. Sale de los datos:
 * las operaciones en efectivo del trimestre. Hoy no hay ninguna, así que es el
 * reporte vacío (columnas 1, 2, 4 y 5). Sin la clave de la entidad no se genera.
 */
export async function archivoRelevantes(ctx: ContextoDePersonal, periodo: unknown, deps: { ahora?: () => Date } = {}): Promise<{ texto: string; sha256: string; nombre: string }> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (typeof periodo !== "string" || !/^20\d{2}(03|06|09|12)$/.test(periodo)) throw new ErrorDeDominio("periodo_invalido");
  const ahora = deps.ahora?.() ?? new Date();
  // Un trimestre abierto no se reporta: el archivo saldría incompleto.
  if (hoyEnMexico(ahora) < mesSiguiente(periodo)) throw new ErrorDeDominio("periodo_sin_cerrar");
  const entidad = await leerEntidad(ctx);
  if (!entidad) throw new ErrorDeDominio("falta_clave_entidad");
  // El trimestre va del primer día de su primer mes al primer día del mes siguiente a su último mes.
  const inicio = `${periodo.slice(0, 4)}-${String(Number(periodo.slice(4, 6)) - 2).padStart(2, "0")}-01`;
  const hasta = mesSiguiente(periodo);
  const relevantes = await conPld(ctx, null, async (consulta) => {
    const total = await operacionesDeTipos(consulta, ctx.personal.operadorId, TIPOS_EN_EFECTIVO, inicio, hasta);
    await auditarPld(consulta, ctx, {
      companyId: null, accion: "pld_archivo_generado", identificador: ctx.personal.operadorId, ocurridoEn: ahora,
      cambio: { reporte: "36", periodo, operaciones: total },
    });
    return total;
  });
  // Con operaciones en efectivo habría que llenar las 41 columnas por operación; hoy no existe ese canal.
  if (relevantes > 0) throw new ErrorDeDominio("reporte_con_operaciones_sin_formato");
  const texto = relevantesVacio({ periodo, organoSupervisor: entidad.claveOrganoSupervisor, claveEntidad: entidad.claveCasfim });
  return { texto, sha256: createHash("sha256").update(texto, "utf8").digest("hex"), nombre: `relevantes-${periodo}.txt` };
}

/**
 * 38ª: constancia interna en ceros del mes. No hay formato público para SOFIPO;
 * si existe uno en el SITI, lo confirma el Oficial. Sale de los datos: las
 * transferencias internacionales del mes (hoy, ninguna).
 */
export async function constanciaInternacionales(
  ctx: ContextoDePersonal,
  periodo: unknown,
  deps: { ahora?: () => Date } = {},
): Promise<{ texto: string; sha256: string; nombre: string }> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (typeof periodo !== "string" || !/^20\d{2}(0[1-9]|1[0-2])$/.test(periodo)) throw new ErrorDeDominio("periodo_invalido");
  const ahora = deps.ahora?.() ?? new Date();
  if (hoyEnMexico(ahora) < mesSiguiente(periodo)) throw new ErrorDeDominio("periodo_sin_cerrar");
  const total = await conPld(ctx, null, async (consulta) => {
    const cuenta = await operacionesDeTipos(consulta, ctx.personal.operadorId, TIPOS_INTERNACIONALES, inicioDelPeriodo(periodo), mesSiguiente(periodo));
    await auditarPld(consulta, ctx, {
      companyId: null, accion: "pld_archivo_generado", identificador: ctx.personal.operadorId, ocurridoEn: ahora,
      cambio: { reporte: "38", periodo, operaciones: cuenta },
    });
    return cuenta;
  });
  if (total > 0) throw new ErrorDeDominio("reporte_con_operaciones_sin_formato");
  const texto = [
    "CONSTANCIA INTERNA. NO ES UN REPORTE PRESENTADO A LA AUTORIDAD.",
    "Disposición 38ª de las DCG del artículo 124 de la LACP: transferencias internacionales de fondos por USD 1,000 o más.",
    `Mes: ${nombreMes(periodo)}.`,
    "Transferencias internacionales enviadas o recibidas en el mes: 0.",
    "No hay formato oficial público para sociedades financieras populares; el Oficial de Cumplimiento confirma en el SITI si existe uno.",
    "Lever no transmite reportes a la UIF ni a la CNBV.",
  ].join("\r\n") + "\r\n";
  return { texto, sha256: createHash("sha256").update(texto, "utf8").digest("hex"), nombre: `constancia-38-${periodo}.txt` };
}

/**
 * Registra el envío de la 36ª (acuse del SITI) o la constancia de la 38ª, con la
 * huella del archivo que generó Lever. Inmutable: uno por reporte y periodo.
 */
export async function registrarPeriodico(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; reporte: unknown; periodo: unknown; folio: unknown; recibidoEn: unknown; registros: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.reportar");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (entrada.reporte !== "36" && entrada.reporte !== "38") throw new ErrorDeDominio("dato_invalido_reporte");
  const archivo = entrada.reporte === "36" ? await archivoRelevantes(ctx, entrada.periodo, deps) : await constanciaInternacionales(ctx, entrada.periodo, deps);
  const ahora = deps.ahora?.() ?? new Date();
  let folio: string | null = null;
  let recibido: Date | null = null;
  let registros = 0;
  if (entrada.reporte === "36") {
    rechazarInvisible(entrada.folio, "folio");
    folio = textoOperativo(entrada.folio, 40);
    if (!folio) throw new ErrorDeDominio("dato_invalido_folio");
    recibido = leerFechaHora(entrada.recibidoEn);
    if (recibido.getTime() > ahora.getTime()) throw new ErrorDeDominio("acuse_fecha_futura");
    const texto = typeof entrada.registros === "string" ? entrada.registros.trim() : "";
    if (!/^\d{1,6}$/.test(texto)) throw new ErrorDeDominio("dato_invalido_registros");
    registros = Number(texto);
  }
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    if ((await consulta.query("select 1 from pld_periodicos where id = $1", [entrada.formId])).rows.length > 0) return;
    await consulta.query(
      `insert into pld_periodicos (id, operator_id, reporte, periodo, archivo_sha256, registros, folio, recibido_en, registrado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [entrada.formId, ctx.personal.operadorId, entrada.reporte, entrada.periodo, archivo.sha256, registros, folio, recibido, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, {
      companyId: null, accion: "pld_periodico_registrado", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { reporte: entrada.reporte as string, periodo: entrada.periodo as string },
    });
  }), "formulario_invalido");
}
