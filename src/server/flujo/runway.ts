import { esPeriodicidad } from "../../dominio/cobranza/periodos";
import type { ErrorFlujo } from "../../dominio/flujo/entradas";
import { desplazar } from "../../dominio/flujo/fechas";
import { corteDe, proyectar, type FuentesFlujo } from "../../dominio/flujo/proyeccion";
import {
  calcularRunway,
  estadoMostrado,
  fotosDeEjemplo,
  horizonteDe,
  MESES_MINIMOS_POR_DEFECTO,
  semanasDe,
  type EstadoAlertas,
  type Foto,
  type PlanFuente,
  type Runway,
} from "../../dominio/flujo/runway";
import { hoyEnMexico } from "../../dominio/personas";
import { baseCliente, exigir, puede, type ContextoConEmpresa, type ContextoDeTenant } from "../../nucleo/contexto";
import { aplicarSentencia, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { booleano, centavos, entero, fecha, fechaONula, instante, lista, registro, texto, unaFila } from "./lectura";
import { fuentesDeFila, leerSaldo, SQL_FUENTES } from "./repositorio";
import { ErrorDeCaptura } from "./servicio";

/**
 * Runway a 12 meses: lectura, vista de Flujo de caja y el mínimo de meses que
 * elige la empresa. La tarea de las alertas (alertas-caja.ts) usa la misma
 * lectura. Todo corre con el contexto de la empresa (RLS).
 */

export type DependenciasRunway = { ahora?: () => Date; auditar?: Auditar };

/**
 * Los planes de cobranza activos con lo que el runway necesita: el siguiente
 * periodo sin cargo (como la tarea de cobranza), los cargos por emitir y los
 * montos de los últimos 3 cargos con monto.
 */
const SQL_PLANES = `
  coalesce((select json_agg(json_build_object(
      'id', p.id, 'cliente', n.nombre, 'concepto', p.concepto, 'tipo', p.tipo, 'monto', p.monto_centavos::text,
      'periodicidad', p.periodicidad, 'primer', to_char(p.primer_vencimiento, 'YYYY-MM-DD'), 'fin', to_char(p.fin, 'YYYY-MM-DD'),
      'siguiente', coalesce((select max(c.periodo) + 1 from collection_charges c where c.company_id = p.company_id and c.plan_id = p.id), 0),
      'por_emitir', coalesce((select json_agg(to_char(c.vencimiento, 'YYYY-MM-DD') order by c.vencimiento)
                                from collection_charges c
                               where c.company_id = p.company_id and c.plan_id = p.id and c.estado = 'por_emitir'), '[]'::json),
      'ultimos', coalesce((select json_agg(x.monto::text order by x.vencimiento desc, x.periodo desc)
                             from (select c.monto_centavos as monto, c.vencimiento, c.periodo
                                     from collection_charges c
                                    where c.company_id = p.company_id and c.plan_id = p.id
                                      and c.monto_centavos is not null and c.estado in ('emitido', 'pagado')
                                    order by c.vencimiento desc, c.periodo desc
                                    limit 3) x), '[]'::json)
    ) order by p.id)
     from collection_plans p
     join collection_customers n on n.id = p.customer_id and n.company_id = p.company_id
    where p.company_id = $1 and p.estado = 'activo'), '[]'::json)`;

/** Fuentes y planes en una sola sentencia: la misma foto de la base, sin contar dos veces un cargo recién generado. */
const SQL_RUNWAY = `select f.*, ${SQL_PLANES} as planes from (${SQL_FUENTES}) f`;

function planesDeFila(valor: unknown): PlanFuente[] {
  return lista(valor).map((p) => {
    const tipo = texto(p.tipo);
    const periodicidad = texto(p.periodicidad);
    if ((tipo !== "fijo" && tipo !== "variable") || !esPeriodicidad(periodicidad)) throw new ErrorDeDominio("base_no_disponible");
    const porEmitir = Array.isArray(p.por_emitir) ? p.por_emitir.map(fecha) : [];
    const ultimos = Array.isArray(p.ultimos) ? p.ultimos.map(centavos) : [];
    return {
      id: texto(p.id),
      cliente: texto(p.cliente),
      concepto: texto(p.concepto),
      tipo,
      montoCentavos: p.monto === null || p.monto === undefined ? null : centavos(p.monto),
      periodicidad,
      primerVencimiento: fecha(p.primer),
      fin: fechaONula(p.fin),
      siguiente: entero(p.siguiente),
      porEmitir,
      ultimosMontos: ultimos,
    };
  });
}

/** Las fuentes del flujo y los planes de cobranza hasta el fin del horizonte. La consulta ya trae su contexto. */
export async function leerRunwayCon(
  consulta: Consulta,
  empresaId: string,
  hoy: string,
): Promise<{ fuentes: FuentesFlujo; planes: PlanFuente[] }> {
  const { saldo, colchonCentavos } = await leerSaldo(consulta, empresaId);
  const corte = corteDe({ hoy, saldo });
  const fila = unaFila(await aplicarSentencia(consulta, SQL_RUNWAY, [empresaId, desplazar(corte, 1), horizonteDe(hoy).fin]));
  return { fuentes: { hoy, saldo, colchonCentavos, ...fuentesDeFila(fila) }, planes: planesDeFila(fila.planes) };
}

export async function leerMesesMinimos(consulta: Consulta, empresaId: string): Promise<{ meses: number; elegido: boolean }> {
  const resultado = await aplicarSentencia(consulta, "select meses_minimos from cash_runway_settings where company_id = $1", [empresaId]);
  const fila = resultado.rows[0];
  return fila ? { meses: entero(registro(fila).meses_minimos), elegido: true } : { meses: MESES_MINIMOS_POR_DEFECTO, elegido: false };
}

export async function leerEstadoAlertas(consulta: Consulta, empresaId: string): Promise<EstadoAlertas | null> {
  const resultado = await aplicarSentencia(consulta, "select bajo_colchon, runway_bajo from cash_alert_states where company_id = $1", [empresaId]);
  const fila = resultado.rows[0];
  if (!fila) return null;
  const f = registro(fila);
  return { bajoColchon: booleano(f.bajo_colchon), runwayBajo: booleano(f.runway_bajo) };
}

/** Las últimas 12 fotos, de la más vieja a la más nueva. */
async function leerFotos(consulta: Consulta, empresaId: string): Promise<Foto[]> {
  const resultado = await aplicarSentencia(
    consulta,
    `select to_char(semana, 'YYYY-MM-DD') as semana, semanas_conservador, semanas_esperado, horizonte_semanas,
            saldo_centavos::text as saldo, to_char(saldo_al_dia, 'YYYY-MM-DD') as al_dia
       from (select * from cash_runway_snapshots where company_id = $1 order by semana desc limit 12) x
      order by semana`,
    [empresaId],
  );
  return lista(resultado.rows).map((f) => ({
    semana: fecha(f.semana),
    semanasConservador: entero(f.semanas_conservador),
    semanasEsperado: entero(f.semanas_esperado),
    horizonte: entero(f.horizonte_semanas),
    saldoCentavos: centavos(f.saldo),
    saldoAlDia: fecha(f.al_dia),
  }));
}

export type AvisoVista = { detectadoEn: string; colchon: boolean; runway: boolean; estado: string };

async function leerUltimoAviso(consulta: Consulta, empresaId: string): Promise<AvisoVista | null> {
  const resultado = await aplicarSentencia(
    consulta,
    "select detectado_en, colchon, runway, estado from cash_alerts where company_id = $1 order by detectado_en desc, id desc limit 1",
    [empresaId],
  );
  const fila = resultado.rows[0];
  if (!fila) return null;
  const f = registro(fila);
  return { detectadoEn: instante(f.detectado_en), colchon: booleano(f.colchon), runway: booleano(f.runway), estado: texto(f.estado) };
}

export type VistaRunway = {
  hoy: string;
  runway: Runway;
  mesesMinimos: number;
  mesesElegidos: boolean;
  /** Lo que la página calcula hoy (la tarea lo guarda en su siguiente corrida). */
  estado: "ok" | "bajo_colchon" | "runway_bajo" | "sin_saldo";
  ultimoAviso: AvisoVista | null;
  fotos: Foto[];
  /** Solo en una empresa de demostración con menos de dos fotos. */
  fotosDeEjemplo: boolean;
  puedeEditar: boolean;
};

export async function leerVistaRunway(ctx: ContextoDeTenant | null | undefined, deps?: DependenciasRunway): Promise<VistaRunway> {
  const conEmpresa = exigir(ctx, "cliente.flujo.ver");
  const hoy = hoyEnMexico((deps?.ahora ?? (() => new Date()))());
  const opciones = { detalleNomina: puede(conEmpresa, "cliente.nomina.detalle.ver") };
  return conContexto(baseCliente(conEmpresa), async (consulta) => {
    const empresaId = conEmpresa.empresa.id;
    const { fuentes, planes } = await leerRunwayCon(consulta, empresaId, hoy);
    const runway = calcularRunway(fuentes, planes, opciones);
    const minimos = await leerMesesMinimos(consulta, empresaId);
    const faltante = proyectar(fuentes, null, opciones).faltante;
    let fotos = await leerFotos(consulta, empresaId);
    let ejemplo = false;
    const actual = semanasDe(runway.conservador, runway.horizonte);
    // A una empresa real nunca se le muestran cifras de ejemplo.
    if (conEmpresa.empresa.demostracion && fotos.length < 2 && actual !== null && fuentes.saldo) {
      fotos = fotosDeEjemplo(hoy, actual, runway.horizonte.semanas, fuentes.saldo.centavos);
      ejemplo = true;
    }
    return {
      hoy,
      runway,
      mesesMinimos: minimos.meses,
      mesesElegidos: minimos.elegido,
      estado: fuentes.saldo
        ? estadoMostrado({ bajoColchon: faltante !== null, runwayBajo: runway.conservador.tipo === "agota" && runway.conservador.meses < minimos.meses })
        : "sin_saldo",
      ultimoAviso: await leerUltimoAviso(consulta, empresaId),
      fotos,
      fotosDeEjemplo: ejemplo,
      puedeEditar: puede(conEmpresa, "cliente.flujo.editar"),
    };
  });
}

// Mínimo de meses -------------------------------------------------------------------

export function validarMesesMinimos(valor: unknown): { ok: true; valor: number } | { ok: false; errores: ErrorFlujo[] } {
  const escrito = typeof valor === "string" ? valor.trim() : "";
  const numero = /^\d{1,2}$/.test(escrito) ? Number(escrito) : NaN;
  if (!Number.isInteger(numero) || numero < 1 || numero > 12) {
    return { ok: false, errores: [{ campo: "meses", mensaje: "Escribe un número entero de meses, de 1 a 12." }] };
  }
  return { ok: true, valor: numero };
}

/** Lo cambian administración y finanzas; la base lo vuelve a exigir. Cambiarlo no manda correo: la siguiente corrida evalúa. */
export async function configurarMesesMinimos(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { meses?: unknown },
  deps?: DependenciasRunway,
): Promise<number> {
  const conEmpresa: ContextoConEmpresa = exigir(ctx, "cliente.flujo.editar");
  const validado = validarMesesMinimos(entrada.meses);
  if (!validado.ok) throw new ErrorDeCaptura(validado.errores);
  const meses = validado.valor;
  const auditar = deps?.auditar ?? auditarPorDefecto;
  await conContexto(baseCliente(conEmpresa), async (consulta) => {
    const previo = await aplicarSentencia(consulta, "select meses_minimos from cash_runway_settings where company_id = $1", [conEmpresa.empresa.id]);
    const anterior = previo.rows[0] ? entero(registro(previo.rows[0]).meses_minimos) : null;
    await auditar(consulta, actorDeCliente(conEmpresa), {
      accion: "configurar_runway",
      identificador: conEmpresa.empresa.id,
      cambio: { meses_anterior: anterior, meses_nuevo: meses },
    });
    await aplicarSentencia(
      consulta,
      `insert into cash_runway_settings (company_id, meses_minimos, actualizado_por)
       values ($1, $2, $3)
       on conflict (company_id) do update
         set meses_minimos = excluded.meses_minimos, actualizado_por = excluded.actualizado_por, actualizado_en = now()`,
      [conEmpresa.empresa.id, meses, conEmpresa.persona.id],
    );
  });
  return meses;
}

