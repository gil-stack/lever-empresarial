import { textoOperativo, uuidValido } from "../../dominio/operacion";
import { hoyEnMexico } from "../../dominio/operacion/comisiones";
import { PROPUESTAS, REGLA, type Propuesta } from "../../dominio/pld/etiquetas";
import { renglonInusual } from "../../dominio/pld/layout41";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirAutenticacionReciente } from "../autenticacion/reautenticacion";
import { motivoEscrito, unaVezPorFormulario } from "../operacion/formulario";
import { exigirEnOperacion } from "../operacion/permisos";
import type { Sesion as SesionConFactor } from "../session/tipos";
import { auditarPld } from "./auditar";
import { conPld, rechazarControl } from "./base";
import { leerFechaHora } from "./comite";
import { leerCaso } from "./casos";
import { leerEntidad } from "./periodicos";

/** Las sesiones con quórum en las que la propuesta quedó aprobada (48ª): de ahí sale un dictamen por Comité. */
export async function sesionesQueAprobaron(ctx: ContextoDePersonal, propuestaId: unknown): Promise<Array<{ id: string; celebradaEl: string }>> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (!uuidValido(propuestaId)) return [];
  return conPld(ctx, null, async (consulta) => {
    const filas = await consulta.query(
      `select s.id, s.celebrada_el::text as celebrada_el from pld_sesiones s
       where s.operator_id = $1 and s.quorum and pld_resultado_votacion(s.id, $2) = 'aprobada'
       order by s.celebrada_el desc, s.registrado_en desc`,
      [ctx.personal.operadorId, propuestaId],
    );
    return (filas.rows as Array<{ id: string; celebrada_el: string }>).map((fila) => ({ id: String(fila.id), celebradaEl: String(fila.celebrada_el) }));
  });
}

/**
 * 40ª, 45ª y 48ª: el dictamen del caso. Con Comité, sale de una sesión válida en
 * la que la propuesta vigente quedó aprobada; con el Oficial (47ª, último
 * párrafo), lo registra el Oficial con su justificación. Después de 60 días se
 * registra igual, marcado «fuera de plazo»: la base lo calcula y nunca lo impide.
 */
export async function dictaminarCaso(
  ctx: ContextoDePersonal,
  sesion: Pick<SesionConFactor, "segundoFactor" | "superficie">,
  entrada: { formId: unknown; casoId: unknown; via: unknown; sesionId: unknown; propuestaId: unknown; resultado: unknown; justificacion: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<{ fueraDePlazo: boolean }> {
  exigirEnOperacion(ctx, "plataforma.pld.dictaminar");
  exigirAutenticacionReciente(sesion, deps.ahora?.() ?? new Date());
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (!uuidValido(entrada.casoId)) throw new ErrorDeDominio("caso_no_existe");
  if (entrada.via !== "comite" && entrada.via !== "oficial") throw new ErrorDeDominio("dato_invalido_via");
  const comite = entrada.via === "comite";
  if (comite && (!uuidValido(entrada.sesionId) || !uuidValido(entrada.propuestaId))) throw new ErrorDeDominio("dato_invalido_sesionId");
  if (!comite && !(PROPUESTAS as readonly unknown[]).includes(entrada.resultado)) throw new ErrorDeDominio("dato_invalido_resultado");
  const justificacion = motivoEscrito(entrada.justificacion, 4000);
  const ahora = deps.ahora?.() ?? new Date();
  return unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    const previo = (await consulta.query("select fuera_de_plazo, caso_id from pld_dictamenes where id = $1", [entrada.formId])).rows[0] as
      | { fuera_de_plazo: boolean; caso_id: string }
      | undefined;
    if (previo) {
      if (previo.caso_id !== entrada.casoId) throw new ErrorDeDominio("caso_no_existe");
      return { fueraDePlazo: previo.fuera_de_plazo === true };
    }
    const resultadoComite = comite
      ? ((await consulta.query("select propuesta from pld_propuestas where id = $1 and caso_id = $2", [entrada.propuestaId, entrada.casoId])).rows[0] as
          | { propuesta: string }
          | undefined)?.propuesta
      : null;
    if (comite && !resultadoComite) throw new ErrorDeDominio("propuesta_no_vigente");
    const fila = (await consulta.query(
      `insert into pld_dictamenes (id, caso_id, operator_id, resultado, justificacion, via, sesion_id, propuesta_id, registrado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning company_id, fuera_de_plazo, resultado`,
      [entrada.formId, entrada.casoId, ctx.personal.operadorId, comite ? resultadoComite : entrada.resultado, justificacion, entrada.via,
        comite ? entrada.sesionId : null, comite ? entrada.propuestaId : null, ctx.persona.id],
    )).rows[0] as { company_id: string | null; fuera_de_plazo: boolean; resultado: string };
    await auditarPld(consulta, ctx, {
      companyId: fila.company_id, accion: "pld_dictamen_registrado", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { resultado: fila.resultado, via: entrada.via as string, fuera_de_plazo: fila.fuera_de_plazo },
    });
    return { fueraDePlazo: fila.fuera_de_plazo === true };
  }), "caso_no_existe");
}

/**
 * Acuse del SITI del reporte de Inusual o Interna Preocupante. Lever no
 * transmite: registra lo que el Oficial recibió. El registro es inmutable.
 */
export async function registrarReportePld(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; casoId: unknown; folio: unknown; periodo: unknown; recibidoEn: unknown; registros: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<{ fueraDePlazo: boolean }> {
  exigirEnOperacion(ctx, "plataforma.pld.reportar");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (!uuidValido(entrada.casoId)) throw new ErrorDeDominio("caso_no_existe");
  rechazarControl(entrada.folio, "dato_invalido_folio");
  const folio = textoOperativo(entrada.folio, 40);
  if (!folio) throw new ErrorDeDominio("dato_invalido_folio");
  const periodo = typeof entrada.periodo === "string" ? entrada.periodo.trim() : "";
  if (!/^\d{8}$/.test(periodo)) throw new ErrorDeDominio("dato_invalido_periodo");
  const recibido = leerFechaHora(entrada.recibidoEn);
  const registros = typeof entrada.registros === "string" && /^\d{1,6}$/.test(entrada.registros.trim()) ? Number(entrada.registros) : NaN;
  if (!Number.isInteger(registros) || registros < 1) throw new ErrorDeDominio("dato_invalido_registros");
  const ahora = deps.ahora?.() ?? new Date();
  if (recibido.getTime() > ahora.getTime()) throw new ErrorDeDominio("acuse_fecha_futura");
  return unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    const previo = (await consulta.query("select fuera_de_plazo from pld_reportes where id = $1", [entrada.formId])).rows[0] as
      | { fuera_de_plazo: boolean }
      | undefined;
    if (previo) return { fueraDePlazo: previo.fuera_de_plazo === true };
    const fila = (await consulta.query(
      `insert into pld_reportes (id, caso_id, dictamen_id, operator_id, tipo_reporte, folio, periodo, recibido_en, registros, registrado_por)
       select $1, $2, d.id, $3, '2', $4, $5, $6, $7, $8 from pld_dictamenes d where d.caso_id = $2
       returning company_id, fuera_de_plazo, tipo_reporte`,
      [entrada.formId, entrada.casoId, ctx.personal.operadorId, folio, periodo, recibido, registros, ctx.persona.id],
    )).rows[0] as { company_id: string | null; fuera_de_plazo: boolean; tipo_reporte: string } | undefined;
    if (!fila) throw new ErrorDeDominio("reporte_sin_dictamen_de_reportar");
    await auditarPld(consulta, ctx, {
      companyId: fila.company_id, accion: "pld_reporte_registrado", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { tipo_reporte: fila.tipo_reporte, fuera_de_plazo: fila.fuera_de_plazo },
    });
    return { fueraDePlazo: fila.fuera_de_plazo === true };
  }), "caso_no_existe");
}

/**
 * Borrador del renglón principal del reporte con el layout de 41 columnas: tipo
 * 2 (inusual) o 3 (interna preocupante), periodo AAAAMMDD del dictamen, claves
 * CASFIM, la descripción con la fecha de cada alerta y el periodo de las
 * operaciones (Anexo 1, columna 40) y las razones del dictamen (columna 41). Con
 * la marca de 24 horas, la leyenda de la 44ª. Las demás columnas las completa el
 * Oficial con los catálogos de la CNBV.
 */
export async function contenidoDelReporte(ctx: ContextoDePersonal, casoId: unknown): Promise<{ renglon: string; tipo: "2" | "3"; periodo: string; faltaClave: boolean }> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  const caso = await leerCaso(ctx, casoId);
  if (!caso?.dictamen || caso.dictamen.resultado === "no_reportar") throw new ErrorDeDominio("reporte_sin_dictamen_de_reportar");
  const entidad = await leerEntidad(ctx);
  const tipo: "2" | "3" = caso.dictamen.resultado === "reportar_inusual" ? "2" : "3";
  const periodo = caso.dictamen.dictaminadoEl.replace(/-/g, "");
  // Fechas en la Ciudad de México, como los plazos.
  const fechas = caso.alertas.map((a) => hoyEnMexico(a.creadaEn)).sort();
  const descripcion = [
    caso.razonSocial ? `CLIENTE: ${caso.razonSocial}` : "SIN CLIENTE RELACIONADO",
    ...caso.alertas.map((a) => `ALERTA ${REGLA[a.regla].titulo} DEL ${hoyEnMexico(a.creadaEn)} (${a.disposicion})`),
    fechas.length ? `PERIODO DE LAS OPERACIONES: ${fechas[0]} A ${fechas[fechas.length - 1]}` : "",
  ].filter(Boolean).join(". ");
  return {
    renglon: renglonInusual({
      tipo,
      periodo,
      folio: 1,
      organoSupervisor: entidad?.claveOrganoSupervisor ?? null,
      claveEntidad: entidad?.claveCasfim ?? null,
      descripcion,
      razones: caso.dictamen.justificacion,
      veinticuatroHoras: caso.marca24h !== null,
    }),
    tipo,
    periodo,
    faltaClave: entidad === null,
  };
}

export function resultadoLegible(resultado: Propuesta): string {
  return resultado === "reportar_inusual" ? "Reportar como inusual" : resultado === "reportar_interna" ? "Reportar como interna preocupante" : "No reportar";
}
