import { formatoPesos } from "../centavos";
import { vencimientoDe, type Periodicidad } from "../cobranza/periodos";
import { sumarCentavos } from "../nomina";
import { desplazar, diasEntre, exigirFecha, fechaConAnio, fechaCorta, lunesDe, primeroDelMes, sumarMeses } from "./fechas";
import { movimientosDe, nominaDeUnaPersona, textoAlcance, type FuentesFlujo, type Movimiento, type Proyeccion, type SaldoDeclarado } from "./proyeccion";

/**
 * Runway a 12 meses. Extiende la proyección de 13 semanas con las mismas reglas
 * y la misma unidad (semanas de lunes a domingo, hora de México), así que sus
 * primeras 13 semanas son las de Inicio. Dos cifras:
 *
 * - Conservador: el saldo declarado, las salidas comprometidas y las entradas
 *   que ya trata la proyección (cobros esperados, cargos emitidos y lo ya
 *   cobrado después del saldo). Sin nada estimado.
 * - Esperado: el conservador más las entradas estimadas de cobranza: los
 *   periodos futuros sin cargo de los planes fijos (su monto) y los de los
 *   planes variables (el promedio de sus últimos 3 cargos con monto). Un plan
 *   variable sin historial no se cuenta y se lista.
 *
 * El runway es el tiempo desde hoy hasta el lunes de la primera semana que
 * cierra en negativo, en meses de 30.4375 días (365.25 / 12) con un decimal
 * hacia abajo. Si ninguna semana cierra en negativo antes de 12 meses, es
 * «12 meses o más». Nada aquí inventa una entrada ni escribe.
 */

export const MESES_RUNWAY = 12;
export const MESES_MINIMOS_POR_DEFECTO = 3;
const DIAS_POR_MES = 365.25 / 12;
/** Cargos con monto que promedia un plan variable. */
export const MUESTRAS_VARIABLE = 3;
/** Tope de periodos por plan: un plan semanal no existe, pero una base rara no hace un ciclo sin fin. */
const TOPE_PERIODOS = 400;

export type PlanFuente = {
  id: string;
  cliente: string;
  concepto: string;
  tipo: "fijo" | "variable";
  /** El monto de cada periodo de un plan fijo; nulo en un variable. */
  montoCentavos: number | null;
  periodicidad: Periodicidad;
  primerVencimiento: string;
  fin: string | null;
  /** El siguiente periodo sin cargo: el mayor periodo con cargo + 1. */
  siguiente: number;
  /** Variable: vencimientos de los cargos generados que siguen sin monto (por emitir). */
  porEmitir: readonly string[];
  /** Variable: los montos de sus cargos con monto, del más reciente al más viejo (hasta 3). */
  ultimosMontos: readonly number[];
};

export type Horizonte = { inicio: string; fin: string; semanas: number; limite: string };

/** Las semanas que cubren al menos 12 meses desde hoy. `limite` es hoy + 12 meses. */
export function horizonteDe(hoy: string): Horizonte {
  const inicio = lunesDe(exigirFecha(hoy));
  const limite = sumarMeses(hoy, MESES_RUNWAY, Number(hoy.slice(8, 10)));
  const semanas = Math.floor(diasEntre(inicio, limite) / 7) + 1;
  return { inicio, fin: desplazar(inicio, semanas * 7 - 1), semanas, limite };
}

/** Una entrada estimada lleva el tipo de su plan. */
export type MovimientoRunway = Movimiento & { estimado?: true; plan?: "fijo" | "variable" };

export type PlanEstimado = { id: string; cliente: string; concepto: string; tipo: "fijo" | "variable"; montoCentavos: number; periodos: number };
export type PlanSinHistorial = { id: string; cliente: string; concepto: string };

/**
 * Las entradas estimadas de cobranza entre `hoy` y `fin`. Un periodo vencido
 * sin cargo no se proyecta (no es dinero por venir). El variable usa el
 * promedio de sus últimos cargos con monto.
 */
export function entradasEstimadas(
  planes: readonly PlanFuente[],
  hoy: string,
  fin: string,
): { movimientos: MovimientoRunway[]; incluidos: PlanEstimado[]; sinHistorial: PlanSinHistorial[] } {
  const movimientos: MovimientoRunway[] = [];
  const incluidos: PlanEstimado[] = [];
  const sinHistorial: PlanSinHistorial[] = [];
  for (const plan of planes) {
    const muestras = plan.ultimosMontos.slice(0, MUESTRAS_VARIABLE);
    const monto =
      plan.tipo === "fijo"
        ? plan.montoCentavos
        : muestras.length > 0
          ? Math.round(sumarCentavos(muestras) / muestras.length)
          : null;
    if (monto === null || monto <= 0) {
      sinHistorial.push({ id: plan.id, cliente: plan.cliente, concepto: plan.concepto });
      continue;
    }
    const fechas: { clave: string; fecha: string }[] = [];
    if (plan.tipo === "variable") {
      for (const fecha of plan.porEmitir) fechas.push({ clave: `plan:${plan.id}:por:${fecha}`, fecha });
    }
    for (let n = plan.siguiente; n < plan.siguiente + TOPE_PERIODOS; n += 1) {
      const fecha = vencimientoDe(plan, n);
      if (fecha > fin || (plan.fin !== null && fecha > plan.fin)) break;
      fechas.push({ clave: `plan:${plan.id}:${n}`, fecha });
    }
    const vigentes = fechas.filter(({ fecha }) => fecha >= hoy && fecha <= fin);
    if (vigentes.length === 0) continue;
    incluidos.push({ id: plan.id, cliente: plan.cliente, concepto: plan.concepto, tipo: plan.tipo, montoCentavos: monto, periodos: vigentes.length });
    for (const { clave, fecha } of vigentes) {
      movimientos.push({
        clave,
        tipo: "cobro",
        sentido: "entrada",
        fecha,
        centavos: monto,
        concepto: `${plan.cliente} · ${plan.concepto}`,
        movible: false,
        estimado: true,
        plan: plan.tipo,
      });
    }
  }
  movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave));
  return { movimientos, incluidos, sinHistorial };
}

export type AlcanceRunway =
  | { tipo: "sin_saldo" }
  /** `semanas`: la primera semana que cierra negativa (0 = esta). `hasta`: el último día que alcanza. */
  | { tipo: "agota"; semanas: number; meses: number; hasta: string }
  | { tipo: "holgado" };

export type SemanaRunway = { indice: number; inicio: string; fin: string; conservador: number | null; esperado: number | null };

export type MesRunway = {
  mes: string;
  entradas: number;
  estimadas: number;
  salidas: number;
  /** Saldo al último día del mes; nulo sin saldo declarado. */
  cierre: number | null;
  cierreEsperado: number | null;
  /** El mes trae la nómina de una sola persona y quien mira no tiene el detalle: dice «reservado» (RFC §4, r64-N3). */
  nominaReservada: boolean;
};

export type TipoResumen = "nomina" | "proveedor" | "obligacion" | "cobro" | "cobrado" | "plan_fijo" | "plan_variable";

export type LineaResumen = { tipo: TipoResumen; centavos: number; movimientos: number; estimado: boolean; reservado: boolean };

export type Runway = {
  hoy: string;
  horizonte: Horizonte;
  saldo: SaldoDeclarado | null;
  semanas: SemanaRunway[];
  meses: MesRunway[];
  conservador: AlcanceRunway;
  esperado: AlcanceRunway;
  /** Lo que cuenta en los 12 meses calendario de `meses`, por tipo: el mismo periodo que la tabla. */
  resumen: LineaResumen[];
  planes: { incluidos: PlanEstimado[]; sinHistorial: PlanSinHistorial[] };
};

export type OpcionesRunway = { detalleNomina?: boolean };

/**
 * La fecha efectiva de un movimiento con las reglas de `proyectar`: nulo si no
 * cuenta (después del horizonte, o un cobro esperado vencido). Lo cobrado y lo
 * atrasado de antes de esta semana cuentan hoy.
 */
function fechaEfectiva(movimiento: MovimientoRunway, hoy: string, inicio: string, fin: string): string | null {
  if (movimiento.fecha > fin) return null;
  if (movimiento.sentido === "entrada" && !movimiento.cobrado && movimiento.fecha < hoy) return null;
  if (movimiento.fecha < inicio || movimiento.atrasado) return hoy;
  return movimiento.fecha < hoy ? hoy : movimiento.fecha;
}

/** Semana en que cuenta, con las reglas de `proyectar`: lo atrasado y lo de antes de esta semana, en la 0. */
function semanaDe(movimiento: MovimientoRunway, inicio: string): number {
  if (movimiento.fecha < inicio || movimiento.atrasado) return 0;
  return Math.floor(diasEntre(inicio, movimiento.fecha) / 7);
}

function alcanceDe(saldo: SaldoDeclarado | null, cierres: readonly (number | null)[], hoy: string, horizonte: Horizonte): AlcanceRunway {
  if (!saldo) return { tipo: "sin_saldo" };
  const k = cierres.findIndex((cierre) => cierre !== null && cierre < 0);
  if (k < 0) return { tipo: "holgado" };
  const lunes = desplazar(horizonte.inicio, k * 7);
  if (lunes > horizonte.limite) return { tipo: "holgado" };
  const meses = Math.floor((Math.max(0, diasEntre(hoy, lunes)) * 10) / DIAS_POR_MES) / 10;
  if (meses >= MESES_RUNWAY) return { tipo: "holgado" };
  return { tipo: "agota", semanas: k, meses, hasta: desplazar(lunes, -1) };
}

export function calcularRunway(fuentes: FuentesFlujo, planes: readonly PlanFuente[], opciones: OpcionesRunway = {}): Runway {
  const hoy = exigirFecha(fuentes.hoy);
  const horizonte = horizonteDe(hoy);
  const comprometidos: MovimientoRunway[] = movimientosDe(fuentes, horizonte.fin);
  const estimadas = entradasEstimadas(planes, hoy, horizonte.fin);

  const netoConservador = new Array<number>(horizonte.semanas).fill(0);
  const netoEstimado = new Array<number>(horizonte.semanas).fill(0);
  const primerMes = primeroDelMes(hoy);
  const meses: MesRunway[] = Array.from({ length: MESES_RUNWAY }, (_, i) => ({
    mes: sumarMeses(primerMes, i, 1),
    entradas: 0,
    estimadas: 0,
    salidas: 0,
    cierre: null,
    cierreEsperado: null,
    nominaReservada: false,
  }));
  const indiceMes = (fecha: string) => {
    const [a, m] = fecha.split("-").map(Number) as [number, number];
    const [a0, m0] = primerMes.split("-").map(Number) as [number, number];
    return (a - a0) * 12 + (m - m0);
  };
  const resumen = new Map<TipoResumen, LineaResumen>();
  const sumarResumen = (tipo: TipoResumen, centavos: number, estimado: boolean, reservado: boolean) => {
    const linea = resumen.get(tipo) ?? { tipo, centavos: 0, movimientos: 0, estimado, reservado: false };
    linea.centavos += centavos;
    linea.movimientos += 1;
    linea.reservado ||= reservado;
    resumen.set(tipo, linea);
  };

  const todos: MovimientoRunway[] = [...comprometidos, ...estimadas.movimientos];
  for (const movimiento of todos) {
    const efectiva = fechaEfectiva(movimiento, hoy, horizonte.inicio, horizonte.fin);
    if (efectiva === null) continue;
    const signo = movimiento.sentido === "entrada" ? 1 : -1;
    const semana = semanaDe(movimiento, horizonte.inicio);
    if (movimiento.estimado) netoEstimado[semana]! += movimiento.centavos;
    else netoConservador[semana]! += signo * movimiento.centavos;

    const i = indiceMes(efectiva);
    const mes = meses[i];
    if (mes) {
      if (movimiento.estimado) mes.estimadas += movimiento.centavos;
      else if (signo > 0) mes.entradas += movimiento.centavos;
      else mes.salidas += movimiento.centavos;
      if (!opciones.detalleNomina && nominaDeUnaPersona(movimiento)) mes.nominaReservada = true;
    }
    // El resumen cuenta lo mismo que la tabla «Mes por mes»: los 12 meses calendario desde este (r64-N2).
    if (mes) {
      const tipo: TipoResumen = movimiento.estimado
        ? movimiento.plan === "variable"
          ? "plan_variable"
          : "plan_fijo"
        : movimiento.cobrado
          ? "cobrado"
          : movimiento.tipo;
      sumarResumen(tipo, movimiento.centavos, movimiento.estimado === true, !opciones.detalleNomina && nominaDeUnaPersona(movimiento));
    }
  }

  // Cierres semanales y mensuales. Sin saldo, los montos se muestran pero no hay saldo.
  const saldoInicial = fuentes.saldo ? fuentes.saldo.centavos : null;
  const semanas: SemanaRunway[] = [];
  let conservador = saldoInicial;
  let esperado = saldoInicial;
  for (let k = 0; k < horizonte.semanas; k += 1) {
    conservador = conservador === null ? null : conservador + netoConservador[k]!;
    esperado = esperado === null ? null : esperado + netoConservador[k]! + netoEstimado[k]!;
    if ((conservador !== null && !Number.isSafeInteger(conservador)) || (esperado !== null && !Number.isSafeInteger(esperado))) {
      throw new Error("centavos_invalidos");
    }
    semanas.push({ indice: k, inicio: desplazar(horizonte.inicio, k * 7), fin: desplazar(horizonte.inicio, k * 7 + 6), conservador, esperado });
  }
  let acumulado = saldoInicial;
  let acumuladoEsperado = saldoInicial;
  for (const mes of meses) {
    if (acumulado !== null && acumuladoEsperado !== null) {
      acumulado += mes.entradas - mes.salidas;
      acumuladoEsperado += mes.entradas + mes.estimadas - mes.salidas;
      mes.cierre = acumulado;
      mes.cierreEsperado = acumuladoEsperado;
    }
  }

  const orden: TipoResumen[] = ["nomina", "proveedor", "obligacion", "cobro", "cobrado", "plan_fijo", "plan_variable"];
  return {
    hoy,
    horizonte,
    saldo: fuentes.saldo,
    semanas,
    meses,
    conservador: alcanceDe(fuentes.saldo, semanas.map((s) => s.conservador), hoy, horizonte),
    esperado: alcanceDe(fuentes.saldo, semanas.map((s) => s.esperado), hoy, horizonte),
    resumen: orden.flatMap((tipo) => {
      const linea = resumen.get(tipo);
      return linea ? [linea] : [];
    }),
    planes: { incluidos: estimadas.incluidos, sinHistorial: estimadas.sinHistorial },
  };
}

/** Semanas de runway para la foto y el aviso: el horizonte completo cuando alcanza 12 meses o más. */
export function semanasDe(alcance: AlcanceRunway, horizonte: Pick<Horizonte, "semanas">): number | null {
  if (alcance.tipo === "sin_saldo") return null;
  return alcance.tipo === "agota" ? alcance.semanas : horizonte.semanas;
}

/** Meses aproximados de una foto: semanas × 7 / 30.4375, con tope de 12. */
export function mesesDeSemanas(semanas: number, horizonte: number): number {
  if (semanas >= horizonte) return MESES_RUNWAY;
  return Math.min(MESES_RUNWAY, Math.floor((semanas * 7 * 10) / DIAS_POR_MES) / 10);
}

export function formatoMeses(meses: number): string {
  const texto = meses.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${texto} ${meses === 1 ? "mes" : "meses"}`;
}

/** El runway en palabras. */
export function textoRunway(alcance: AlcanceRunway): string {
  if (alcance.tipo === "sin_saldo") return "Sin saldo declarado";
  if (alcance.tipo === "holgado") return "12 meses o más";
  if (alcance.semanas === 0) return "No alcanza esta semana";
  return `${formatoMeses(alcance.meses)} (alcanza hasta el ${fechaConAnio(alcance.hasta)})`;
}

/**
 * El renglón del runway en el aviso de caja (r64-N1), completo para cada caso:
 * «Runway: con lo comprometido, tu dinero dura 2.9 meses (hasta el 4 de abril de
 * 2027), menos que tu mínimo de 3 meses.» o, si no alcanza ni esta semana, «…tu
 * dinero no alcanza ni para esta semana; tu mínimo es de 3 meses.».
 */
export function fraseRunwayDelAviso(alcance: AlcanceRunway, minimo: string): string {
  if (alcance.tipo === "agota" && alcance.semanas === 0) {
    return `Runway: con lo comprometido, tu dinero no alcanza ni para esta semana; tu mínimo es de ${minimo}.`;
  }
  if (alcance.tipo === "agota") {
    return `Runway: con lo comprometido, tu dinero dura ${formatoMeses(alcance.meses)} (hasta el ${fechaConAnio(alcance.hasta)}), menos que tu mínimo de ${minimo}.`;
  }
  // Un aviso de runway solo sale con el runway agotándose; lo demás se dice como en la vista.
  return `Runway: con lo comprometido, ${textoRunway(alcance).toLocaleLowerCase("es-MX")}; tu mínimo es de ${minimo}.`;
}

/**
 * El alcance de Inicio y del correo del lunes: hasta 13 semanas, igual que
 * hoy; más allá, el runway conservador en lugar de un promedio.
 */
export function textoAlcanceConRunway(p: Pick<Proyeccion, "alcance">, runway: Pick<Runway, "conservador"> | null): string {
  if (p.alcance.tipo !== "holgado" || !runway) return textoAlcance(p);
  const r = runway.conservador;
  if (r.tipo === "holgado") return "Más de 13 semanas (12 meses o más con lo programado)";
  if (r.tipo === "agota") return `Más de 13 semanas (runway de ${formatoMeses(r.meses)}, hasta el ${fechaCorta(r.hasta)})`;
  return textoAlcance(p);
}

// Alertas -------------------------------------------------------------------------------

export type EstadoAlertas = { bajoColchon: boolean; runwayBajo: boolean };

export const SIN_ALERTAS: EstadoAlertas = { bajoColchon: false, runwayBajo: false };

/** ¿El runway conservador está debajo del mínimo? Sin saldo, no; con 12 meses o más, tampoco. */
export function runwayBajo(alcance: AlcanceRunway, mesesMinimos: number): boolean {
  return alcance.tipo === "agota" && alcance.meses < mesesMinimos;
}

/**
 * Un aviso por cruce: solo avisa lo que pasó de apagado a encendido. Lo que
 * sigue encendido no se repite; lo que se apaga no avisa y deja listo el
 * siguiente cruce.
 */
export function transicion(antes: EstadoAlertas | null, ahora: EstadoAlertas): { cambia: boolean; avisar: { colchon: boolean; runway: boolean } | null } {
  const previo = antes ?? SIN_ALERTAS;
  const colchon = ahora.bajoColchon && !previo.bajoColchon;
  const runway = ahora.runwayBajo && !previo.runwayBajo;
  return {
    cambia: previo.bajoColchon !== ahora.bajoColchon || previo.runwayBajo !== ahora.runwayBajo,
    avisar: colchon || runway ? { colchon, runway } : null,
  };
}

/** El estado que se muestra: el colchón pesa más porque es lo de las próximas 13 semanas. */
export function estadoMostrado(estado: EstadoAlertas): "ok" | "bajo_colchon" | "runway_bajo" {
  if (estado.bajoColchon) return "bajo_colchon";
  if (estado.runwayBajo) return "runway_bajo";
  return "ok";
}

// Tendencia ------------------------------------------------------------------------------

export type Foto = { semana: string; semanasConservador: number; semanasEsperado: number; horizonte: number; saldoCentavos: number; saldoAlDia: string };

/**
 * Solo para empresas de demostración sin fotos suficientes: ocho semanas de
 * ejemplo que terminan en el runway de hoy. Nunca se muestra a una empresa real.
 */
export function fotosDeEjemplo(hoy: string, actual: number, horizonte: number, saldoCentavos: number): Foto[] {
  const subidas = [6, 5, 5, 4, 3, 2, 1, 0];
  const lunes = lunesDe(hoy);
  return subidas.map((extra, i) => {
    const semanas = Math.min(horizonte, actual + extra);
    return {
      semana: desplazar(lunes, (i - (subidas.length - 1)) * 7),
      semanasConservador: semanas,
      semanasEsperado: Math.min(horizonte, semanas + 4),
      horizonte,
      saldoCentavos,
      saldoAlDia: hoy,
    };
  });
}

/** La cifra de un resumen en palabras, con la nómina reservada sin monto. */
export function cifraDeResumen(linea: Pick<LineaResumen, "centavos" | "reservado">): string {
  return linea.reservado ? "Monto reservado" : formatoPesos(linea.centavos);
}
