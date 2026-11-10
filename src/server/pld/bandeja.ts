import { hoyEnMexico } from "../../dominio/operacion";
import type { Propuesta } from "../../dominio/pld/etiquetas";
import { diasNaturales } from "../../dominio/pld/plazos";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { exigirEnOperacion } from "../operacion/permisos";
import { conPld, dia, diaOpcional, fecha, fechaOpcional } from "./base";
import { leerComite, leerModoDictamen, type ComunicacionPendiente } from "./comite";
import { listarAlertasPld, type AlertaPld } from "./casos";
import { leerEntidad, leerPeriodicos, type Periodico } from "./periodicos";
import { leerEvaluacionesPendientes, type EvaluacionPendiente } from "./perfil";

export type CasoAbierto = {
  id: string;
  razonSocial: string | null;
  alertas: number;
  venceEl: string | null;
  venceEn: Date | null;
  diasRestantes: number | null;
  fueraDePlazo: boolean;
  propuesta: Propuesta | null;
};

export type PorReportar = {
  casoId: string;
  razonSocial: string | null;
  resultado: Propuesta;
  reporteVenceEl: string | null;
  reporteVenceEn: Date | null;
  diasHabiles: number | null;
  vencido: boolean;
};

export type BandejaPld = {
  alertasSinCaso: AlertaPld[];
  casosAbiertos: CasoAbierto[];
  porReportar: PorReportar[];
  periodicos: Periodico[];
  evaluaciones: EvaluacionPendiente[];
  comunicacionesComite: ComunicacionPendiente[];
  sesionDelMesPendiente: boolean;
  mesesSinSesion: string[];
  /** r2-base-N18: cambios de perfil que propuso Originación con la empresa activa, por resolver. */
  propuestasDePerfil: Array<{ propuestaId: string; companyId: string; razonSocial: string; propuestaEn: Date }>;
  /** B (25ª): empresas activas sin perfil transaccional ni propuesta por resolver; las de demostración no entran a PLD. */
  sinPerfil: Array<{ companyId: string; razonSocial: string }>;
  faltaClaveEntidad: boolean;
  faltaCalendario: number | null;
  modo: "comite" | "oficial";
};

/**
 * Lo que Cumplimiento tiene que atender, calculado al leer con el «hoy» de la
 * Ciudad de México: alertas por analizar con sus días, casos por dictaminar,
 * dictámenes por reportar en días hábiles, reportes periódicos, evaluaciones
 * semestrales, avisos de integración del Comité y la sesión del mes.
 */
export async function leerBandejaPld(ctx: ContextoDePersonal, opciones: { ahora?: Date } = {}): Promise<BandejaPld> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  const ahora = opciones.ahora ?? new Date();
  const hoy = hoyEnMexico(ahora);
  const [alertasSinCaso, periodicos, evaluaciones, comite, modo, entidad] = [
    await listarAlertasPld(ctx, { ahora, soloSinCaso: true }),
    await leerPeriodicos(ctx, { ahora }),
    await leerEvaluacionesPendientes(ctx, { ahora }),
    await leerComite(ctx, { ahora }),
    await leerModoDictamen(ctx),
    await leerEntidad(ctx),
  ];
  const { casosAbiertos, porReportar, faltaCalendarioHoy, propuestasDePerfil, sinPerfil } = await conPld(ctx, null, async (consulta) => {
    const propuestas = (await consulta.query(
      `select x.id, x.company_id, c.razon_social, x.registrado_en
       from pld_perfil_propuestas x join companies c on c.id = x.company_id
       where not exists (select 1 from pld_perfil_resoluciones r where r.propuesta_id = x.id)
       order by x.registrado_en`,
      [],
    )).rows as Array<Record<string, unknown>>;
    // Solo pueden ser de antes de la 0030: el candado ya no activa a nadie sin perfil. La que tiene una propuesta
    // por resolver ya aparece en «Por resolver».
    const sinPerfil = (await consulta.query(
      `select c.id, c.razon_social from companies c
       where c.estado = 'activa' and not c.demostracion
         and not exists (select 1 from pld_perfiles p where p.company_id = c.id)
         and not exists (select 1 from pld_perfil_propuestas x where x.company_id = c.id
                         and not exists (select 1 from pld_perfil_resoluciones r where r.propuesta_id = x.id))
       order by c.razon_social`,
      [],
    )).rows as Array<Record<string, unknown>>;
    const casos = (await consulta.query(
      `select k.id, c.razon_social, pld_caso_vence(k.id)::text as vence_el, m.registrado_en as marca_en,
              (select count(*) from pld_caso_alertas ca where ca.caso_id = k.id)::int as alertas,
              (select p.propuesta from pld_propuestas p where p.caso_id = k.id order by p.registrado_en desc, p.id desc limit 1) as propuesta
       from pld_casos k left join companies c on c.id = k.company_id left join pld_casos_24h m on m.caso_id = k.id
       where not exists (select 1 from pld_dictamenes d where d.caso_id = k.id)
       order by vence_el nulls first`,
      [],
    )).rows as Array<Record<string, unknown>>;
    const reportar = (await consulta.query(
      `select d.caso_id, c.razon_social, d.resultado, d.reporte_vence_el::text as vence_el, d.reporte_vence_en,
              case when d.reporte_vence_el is null then null else pld_dias_habiles_entre($1::date, d.reporte_vence_el) end as dias
       from pld_dictamenes d left join companies c on c.id = d.company_id
       where d.resultado <> 'no_reportar' and not exists (select 1 from pld_reportes r where r.caso_id = d.caso_id)
       order by d.reporte_vence_el nulls first`,
      [hoy],
    )).rows as Array<Record<string, unknown>>;
    const calendario = (await consulta.query("select pld_calendario_cargado($1) as cargado", [Number(hoy.slice(0, 4))])).rows[0] as { cargado: boolean };
    return {
      casosAbiertos: casos.map((fila): CasoAbierto => {
        const marcaEn = fechaOpcional(fila.marca_en);
        const venceEn = marcaEn ? new Date(marcaEn.getTime() + 24 * 3_600_000) : null;
        const venceEl = venceEn ? null : diaOpcional(fila.vence_el);
        const diasRestantes = venceEl ? diasNaturales(hoy, venceEl) : null;
        return {
          id: String(fila.id),
          razonSocial: typeof fila.razon_social === "string" ? fila.razon_social : null,
          alertas: Number(fila.alertas),
          venceEl,
          venceEn,
          diasRestantes,
          fueraDePlazo: venceEn ? ahora.getTime() > venceEn.getTime() : diasRestantes !== null && diasRestantes < 0,
          propuesta: typeof fila.propuesta === "string" ? (fila.propuesta as Propuesta) : null,
        };
      }),
      porReportar: reportar.map((fila): PorReportar => {
        const venceEl = diaOpcional(fila.vence_el);
        const venceEn = fila.reporte_vence_en ? fecha(fila.reporte_vence_en) : null;
        return {
          casoId: String(fila.caso_id),
          razonSocial: typeof fila.razon_social === "string" ? fila.razon_social : null,
          resultado: fila.resultado as Propuesta,
          reporteVenceEl: venceEl,
          reporteVenceEn: venceEn,
          diasHabiles: fila.dias === null || fila.dias === undefined ? null : Number(fila.dias),
          vencido: venceEn ? ahora.getTime() > venceEn.getTime() : venceEl !== null && venceEl < hoy,
        };
      }),
      faltaCalendarioHoy: calendario.cargado ? null : Number(hoy.slice(0, 4)),
      propuestasDePerfil: propuestas.map((fila) => ({
        propuestaId: String(fila.id), companyId: String(fila.company_id), razonSocial: String(fila.razon_social), propuestaEn: fecha(fila.registrado_en),
      })),
      sinPerfil: sinPerfil.map((fila) => ({ companyId: String(fila.id), razonSocial: String(fila.razon_social) })),
    };
  });
  const faltaPeriodicos = periodicos.map((p) => p.faltaCalendario).filter((anio): anio is number => anio !== null);
  const faltaCalendario = faltaCalendarioHoy ?? (faltaPeriodicos.length ? Math.min(...faltaPeriodicos) : null);
  return {
    alertasSinCaso,
    casosAbiertos,
    porReportar,
    periodicos,
    evaluaciones,
    comunicacionesComite: modo.modo === "comite" ? comite.pendientes : [],
    sesionDelMesPendiente: modo.modo === "comite" && !comite.sesionDelMes,
    mesesSinSesion: comite.mesesSinSesion,
    propuestasDePerfil,
    sinPerfil,
    faltaClaveEntidad: entidad === null,
    faltaCalendario,
    modo: modo.modo,
  };
}

export { dia };
