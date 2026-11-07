import { formatoPesos } from "../centavos";
import { siguientePago, sumarCentavos, type FrecuenciaNomina } from "../nomina";
import {
  adelantarMeses,
  adelantarObligacion,
  adelantarQuincenal,
  adelantarSemanal,
  desplazar,
  diasEntre,
  exigirFecha,
  fechasDeSerie,
  lunesDe,
  siguienteObligacion,
  type FrecuenciaObligacion,
} from "./fechas";

/**
 * Proyección de 13 semanas (lunes a domingo, hora de México) a partir del
 * último saldo declarado. Reglas, dichas una vez:
 *
 * - El saldo declarado es «al cierre del día X». Lo que tiene fecha hasta X ya
 *   está en ese saldo; solo cuenta lo que vence después de X (el corte). Sin
 *   saldo declarado, el corte es el domingo anterior a esta semana.
 * - Salidas: nómina por frecuencia y próxima fecha (y los lotes ya
 *   preparados), pagos a proveedores no cancelados ni rechazados según su
 *   fecha programada y obligaciones recurrentes activas. Una salida posterior
 *   al corte pero anterior a esta semana sigue debiéndose: entra en la
 *   primera semana marcada como atrasada.
 * - Un cargo de proveedor con fecha programada hasta el corte: si ya estaba
 *   autorizado (listo para pagar) se da por pagado y reflejado en el saldo
 *   declarado, porque Lever no registra el pago. Si nadie lo autorizó (por
 *   autorizar o sin solicitud), sigue debiéndose: entra en la primera semana
 *   como vencido sin autorizar.
 * - Una obligación con su proveedor cuenta lo que le falta: su monto menos las
 *   facturas vivas de ese proveedor en el mes, nunca menos de cero.
 * - Entradas: cobros esperados y lo ya cobrado después del corte (en la semana
 *   en que llegó). Un cobro esperado cuya fecha ya pasó está vencido y no se
 *   cuenta: no se proyecta dinero que ya llegó tarde.
 * - Nada aquí escribe: el escenario cambia la fecha de un movimiento en esta
 *   copia y vuelve a calcular.
 * - Sin permiso de ver el detalle de la nómina, el pago de una sola persona no
 *   se desglosa: la semana junta toda su nómina en un renglón «Nómina».
 */

export const SEMANAS = 13;

/** Estado del pago para el flujo: sin cancelados ni rechazados. */
export type EstadoPagoFlujo = "por_autorizar" | "listo_para_pagar" | "sin_solicitud";

export type OrigenCifra = "comprometido" | "declarado" | "banco_demo";

export type TipoMovimiento = "nomina" | "proveedor" | "obligacion" | "cobro";

export type Movimiento = {
  /** cxp:<cargo>, obl:<obligación>:<fecha>, nom:<fecha>, lote:<lote>, cob:<cobro>. */
  clave: string;
  tipo: TipoMovimiento;
  sentido: "entrada" | "salida";
  fecha: string;
  centavos: number;
  concepto: string;
  /** Se puede mover en el escenario: pagos a proveedores y obligaciones. */
  movible: boolean;
  atrasado?: boolean;
  /** Pago a proveedor que nadie ha autorizado (por autorizar o sin solicitud). */
  sinAutorizar?: boolean;
  /** Obligación con proveedor: lo que ese proveedor ya facturó en el mes y se descontó. */
  facturadoCentavos?: number;
  /** Cobro ya recibido (después del corte): entra en la semana en que llegó. */
  cobrado?: boolean;
  /** Nómina: cuántas personas suma el movimiento. */
  personas?: number;
  /** La fecha real cuando el escenario la movió. */
  fechaOriginal?: string;
  /** Nómina vista sin detalle que puede ser el neto de una sola persona: su monto no se muestra. */
  reservado?: boolean;
};

export type SaldoDeclarado = {
  centavos: number;
  alDia: string;
  autor: string;
  declaradoEn: string;
};

export type FuentesFlujo = {
  hoy: string;
  saldo: SaldoDeclarado | null;
  colchonCentavos: number;
  nomina: readonly {
    netoCentavos: number;
    frecuencia: FrecuenciaNomina;
    proximoPagoEn: string;
    anclaDia: number;
    altaEn: string;
    bajaEn: string | null;
  }[];
  lotes: readonly { id: string; fechaPago: string; totalCentavos: number; personas?: number }[];
  /** Ya sin cancelados, rechazados ni anulados. */
  pagos: readonly { id: string; proveedor: string; referencia: string; totalCentavos: number; programadaEl: string; estado: EstadoPagoFlujo }[];
  obligaciones: readonly {
    id: string;
    concepto: string;
    montoCentavos: number;
    frecuencia: FrecuenciaObligacion;
    proximaFecha: string;
    anclaDia: number;
    /** Por mes (YYYY-MM), lo que su proveedor ya trae en cargos vivos: se descuenta de la obligación. */
    cargosPorMes?: Readonly<Record<string, number>>;
  }[];
  /** Solo los que siguen esperados. */
  cobros: readonly { id: string; cliente: string; concepto: string; montoCentavos: number; fechaProbable: string }[];
  /** Los ya cobrados, por la fecha en que llegó el dinero. */
  cobrados: readonly { id: string; cliente: string; concepto: string; montoCentavos: number; cobradoEl: string }[];
};

export type Semana = {
  indice: number;
  inicio: string;
  fin: string;
  saldoInicial: number | null;
  entradas: number;
  salidas: number;
  saldoFinal: number | null;
  movimientos: Movimiento[];
};

export type Escenario = { clave: string; fecha: string };

export type Faltante = {
  semana: number;
  inicio: string;
  fin: string;
  saldoFinal: number;
  motivo: "negativo" | "colchon";
  causas: Movimiento[];
};

export type Alcance =
  | { tipo: "sin_saldo" }
  | { tipo: "semanas"; semanas: number }
  | { tipo: "holgado"; meses: number | null };

export type Proyeccion = {
  hoy: string;
  inicio: string;
  fin: string;
  corte: string;
  saldo: SaldoDeclarado | null;
  colchonCentavos: number;
  semanas: Semana[];
  atrasados: Movimiento[];
  entradas: number;
  salidas: number;
  /** Salidas comprometidas de las primeras cuatro semanas. */
  comprometido4: number;
  entradas4: number;
  /** (salidas − entradas) de las 13 semanas entre 3: trece semanas son tres meses. */
  gastoNetoMensual: number;
  alcance: Alcance;
  faltante: Faltante | null;
  escenario: (Escenario & { concepto: string }) | null;
  /** Lo que se puede mover en el escenario, en orden de fecha. */
  movibles: Movimiento[];
};

export function ventanaDe(hoy: string): { inicio: string; fin: string } {
  const inicio = lunesDe(exigirFecha(hoy));
  return { inicio, fin: desplazar(inicio, SEMANAS * 7 - 1) };
}

const FRECUENCIA_NOMINA: Record<FrecuenciaNomina, string> = {
  semanal: "semanal",
  quincenal: "quincenal",
  mensual: "mensual",
};

/**
 * Los movimientos que cuentan para la proyección: después del corte y hasta el
 * fin de la ventana, más los cargos de proveedor hasta el corte que nadie
 * autorizó, que van como vencidos sin autorizar. Los autorizados hasta el
 * corte se dan por pagados: ya están en el saldo declarado.
 */
export function movimientosDe(fuentes: FuentesFlujo): Movimiento[] {
  const desde = desplazar(corteDe(fuentes), 1);
  const atrasados = fuentes.pagos
    .filter((pago) => pago.programadaEl < desde && pago.estado !== "listo_para_pagar")
    .map((pago) => ({ ...movimientoDePago(pago), atrasado: true }));
  return [...atrasados, ...movimientosEntre(fuentes, desde, ventanaDe(fuentes.hoy).fin)];
}

function movimientoDePago(pago: FuentesFlujo["pagos"][number]): Movimiento {
  return {
    clave: `cxp:${pago.id}`,
    tipo: "proveedor",
    sentido: "salida",
    fecha: pago.programadaEl,
    centavos: pago.totalCentavos,
    concepto: `${pago.proveedor} · ${pago.referencia}`,
    movible: true,
    ...(pago.estado === "listo_para_pagar" ? {} : { sinAutorizar: true }),
  };
}

/**
 * Lo que falta por pagar en cada fecha de una obligación con proveedor: las
 * facturas vivas de ese proveedor en el mes se descuentan, en orden, hasta
 * agotarse. Una renta de $30,000 con una factura de $500 cuenta $29,500; con
 * la factura completa, nada. Lo usan la proyección, el calendario y los
 * presupuestos.
 */
export function restantesDeObligacion(
  fechas: readonly string[],
  montoCentavos: number,
  cargosPorMes: Readonly<Record<string, number>> = {},
): { fecha: string; centavos: number; facturadoCentavos: number }[] {
  const disponible = new Map(Object.entries(cargosPorMes));
  return fechas.map((fecha) => {
    const mes = fecha.slice(0, 7);
    const facturas = disponible.get(mes) ?? 0;
    const facturadoCentavos = Math.min(Math.max(facturas, 0), montoCentavos);
    disponible.set(mes, facturas - facturadoCentavos);
    return { fecha, centavos: montoCentavos - facturadoCentavos, facturadoCentavos };
  });
}

/** Todos los movimientos con fecha entre `desde` y `fin` (incluidas). El calendario usa el mes. */
export function movimientosEntre(fuentes: FuentesFlujo, desde: string, fin: string): Movimiento[] {
  const movimientos: Movimiento[] = [];

  // Nómina: una salida por fecha, sumada. El neto de cada persona no se muestra aquí.
  const porFecha = new Map<string, { centavos: number[]; personas: number; frecuencias: Set<string> }>();
  for (const perfil of fuentes.nomina) {
    const ultimo = perfil.bajaEn && perfil.bajaEn < fin ? perfil.bajaEn : fin;
    const fechas = fechasDeSerie(
      perfil.proximoPagoEn,
      (fecha) => siguientePago(fecha, perfil.frecuencia, perfil.anclaDia),
      desde > perfil.altaEn ? desde : perfil.altaEn,
      ultimo,
      perfil.frecuencia === "semanal"
        ? adelantarSemanal
        : perfil.frecuencia === "quincenal"
          ? adelantarQuincenal
          : (base, inicio) => adelantarMeses(base, inicio, 1, perfil.anclaDia),
    );
    for (const fecha of fechas) {
      const grupo = porFecha.get(fecha) ?? { centavos: [], personas: 0, frecuencias: new Set<string>() };
      grupo.centavos.push(perfil.netoCentavos);
      grupo.personas += 1;
      grupo.frecuencias.add(FRECUENCIA_NOMINA[perfil.frecuencia]);
      porFecha.set(fecha, grupo);
    }
  }
  for (const [fecha, grupo] of porFecha) {
    const personas = grupo.personas === 1 ? "1 persona" : `${grupo.personas} personas`;
    movimientos.push({
      clave: `nom:${fecha}`,
      tipo: "nomina",
      sentido: "salida",
      fecha,
      centavos: sumarCentavos(grupo.centavos),
      concepto: `Nómina ${[...grupo.frecuencias].sort().join(" y ")} (${personas})`,
      movible: false,
      personas: grupo.personas,
    });
  }
  for (const lote of fuentes.lotes) {
    if (lote.fechaPago < desde || lote.fechaPago > fin) continue;
    movimientos.push({
      clave: `lote:${lote.id}`,
      tipo: "nomina",
      sentido: "salida",
      fecha: lote.fechaPago,
      centavos: lote.totalCentavos,
      concepto: "Lote de nómina preparado",
      movible: false,
      ...(lote.personas === undefined ? {} : { personas: lote.personas }),
    });
  }
  for (const pago of fuentes.pagos) {
    if (pago.programadaEl < desde || pago.programadaEl > fin) continue;
    movimientos.push(movimientoDePago(pago));
  }
  for (const obligacion of fuentes.obligaciones) {
    const fechas = fechasDeSerie(
      obligacion.proximaFecha,
      (fecha) => siguienteObligacion(fecha, obligacion.frecuencia, obligacion.anclaDia),
      desde,
      fin,
      (base, inicio) => adelantarObligacion(base, inicio, obligacion.frecuencia, obligacion.anclaDia),
    );
    for (const { fecha, centavos, facturadoCentavos } of restantesDeObligacion(fechas, obligacion.montoCentavos, obligacion.cargosPorMes)) {
      if (centavos === 0) continue;
      movimientos.push({
        clave: `obl:${obligacion.id}:${fecha}`,
        tipo: "obligacion",
        sentido: "salida",
        fecha,
        centavos,
        concepto:
          facturadoCentavos > 0
            ? `${obligacion.concepto}: ${formatoPesos(centavos)} restantes (ya hay factura por ${formatoPesos(facturadoCentavos)})`
            : obligacion.concepto,
        movible: true,
        ...(facturadoCentavos > 0 ? { facturadoCentavos } : {}),
      });
    }
  }
  for (const cobro of fuentes.cobros) {
    if (cobro.fechaProbable < desde || cobro.fechaProbable > fin) continue;
    movimientos.push({
      clave: `cob:${cobro.id}`,
      tipo: "cobro",
      sentido: "entrada",
      fecha: cobro.fechaProbable,
      centavos: cobro.montoCentavos,
      concepto: `${cobro.cliente} · ${cobro.concepto}`,
      movible: false,
    });
  }
  for (const cobro of fuentes.cobrados) {
    if (cobro.cobradoEl < desde || cobro.cobradoEl > fin) continue;
    movimientos.push({
      clave: `cob:${cobro.id}`,
      tipo: "cobro",
      sentido: "entrada",
      fecha: cobro.cobradoEl,
      centavos: cobro.montoCentavos,
      concepto: `${cobro.cliente} · ${cobro.concepto}`,
      movible: false,
      cobrado: true,
    });
  }
  // Orden estable para la pantalla y las pruebas.
  return movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave));
}

export function corteDe(fuentes: Pick<FuentesFlujo, "hoy" | "saldo">): string {
  return fuentes.saldo ? exigirFecha(fuentes.saldo.alDia) : desplazar(ventanaDe(fuentes.hoy).inicio, -1);
}

export type OpcionesProyeccion = {
  /** Quien puede ver el detalle de la nómina (cliente.nomina.detalle.ver). Sin él, el pago de una persona no se desglosa. */
  detalleNomina?: boolean;
};

/** ¿Este movimiento de nómina deja ver el neto de una sola persona? */
export function nominaDeUnaPersona(movimiento: Pick<Movimiento, "tipo" | "personas">): boolean {
  return movimiento.tipo === "nomina" && movimiento.personas !== undefined && movimiento.personas < 2;
}

/**
 * Sin detalle de nómina: si en la semana algún pago de nómina es de una sola
 * persona, toda la nómina de la semana se junta en un renglón «Nómina», sin
 * conteo ni frecuencia. El total de la semana no cambia.
 */
function reservarNomina(movimientos: Movimiento[], semana: string): Movimiento[] {
  if (!movimientos.some(nominaDeUnaPersona)) return movimientos;
  const nomina = movimientos.filter((movimiento) => movimiento.tipo === "nomina");
  const junta: Movimiento = {
    clave: `nom:semana:${semana}`,
    tipo: "nomina",
    sentido: "salida",
    fecha: nomina.reduce((primera, movimiento) => (movimiento.fecha < primera ? movimiento.fecha : primera), nomina[0]!.fecha),
    centavos: sumarCentavos(nomina.map((movimiento) => movimiento.centavos)),
    concepto: "Nómina",
    movible: false,
    reservado: true,
    ...(nomina.some((movimiento) => movimiento.atrasado) ? { atrasado: true } : {}),
  };
  return [...movimientos.filter((movimiento) => movimiento.tipo !== "nomina"), junta].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave),
  );
}

export function proyectar(fuentes: FuentesFlujo, escenario: Escenario | null = null, opciones: OpcionesProyeccion = {}): Proyeccion {
  const { inicio, fin } = ventanaDe(fuentes.hoy);
  const corte = corteDe(fuentes);
  const base = movimientosDe(fuentes);
  // Lo que sigue por venir y lo atrasado (que va a la primera semana) se puede mover a una fecha nueva.
  const movibles = base.filter(
    (movimiento) => movimiento.movible && (movimiento.fecha >= fuentes.hoy || movimiento.atrasado === true || movimiento.fecha < inicio),
  );

  let aplicado: Proyeccion["escenario"] = null;
  const movimientos = base.map((movimiento) => {
    if (!escenario || movimiento.clave !== escenario.clave || !movimiento.movible) return movimiento;
    aplicado = { ...escenario, concepto: movimiento.concepto };
    // Movido, ya no está atrasado: cuenta en la semana de su fecha nueva.
    const movido: Movimiento = { ...movimiento, fecha: escenario.fecha, fechaOriginal: movimiento.fecha };
    delete movido.atrasado;
    return movido;
  });

  const semanas: Semana[] = Array.from({ length: SEMANAS }, (_, indice) => ({
    indice,
    inicio: desplazar(inicio, indice * 7),
    fin: desplazar(inicio, indice * 7 + 6),
    saldoInicial: null,
    entradas: 0,
    salidas: 0,
    saldoFinal: null,
    movimientos: [],
  }));
  const atrasados: Movimiento[] = [];

  for (const movimiento of movimientos) {
    if (movimiento.fecha > fin) continue;
    // Un cobro esperado con fecha pasada está vencido: no se proyecta dinero que ya llegó tarde.
    if (movimiento.sentido === "entrada" && !movimiento.cobrado && movimiento.fecha < fuentes.hoy) continue;
    // Lo cobrado después del corte y antes de esta semana ya está en la cuenta: va a la primera semana.
    if (movimiento.cobrado && movimiento.fecha < inicio) {
      semanas[0]?.movimientos.push(movimiento);
      continue;
    }
    if (movimiento.fecha < inicio || movimiento.atrasado) {
      const atrasado = { ...movimiento, atrasado: true };
      atrasados.push(atrasado);
      semanas[0]?.movimientos.push(atrasado);
      continue;
    }
    semanas[Math.floor(diasEntre(inicio, movimiento.fecha) / 7)]?.movimientos.push(movimiento);
  }

  if (!opciones.detalleNomina) {
    for (const semana of semanas) semana.movimientos = reservarNomina(semana.movimientos, semana.inicio);
    for (const [indice, atrasado] of atrasados.entries()) {
      if (nominaDeUnaPersona(atrasado)) atrasados[indice] = { ...atrasado, concepto: "Nómina", personas: undefined, reservado: true };
    }
  }

  let saldo = fuentes.saldo ? fuentes.saldo.centavos : null;
  for (const semana of semanas) {
    semana.entradas = sumarCentavos(semana.movimientos.filter((m) => m.sentido === "entrada").map((m) => m.centavos));
    semana.salidas = sumarCentavos(semana.movimientos.filter((m) => m.sentido === "salida").map((m) => m.centavos));
    semana.saldoInicial = saldo;
    saldo = saldo === null ? null : saldo + semana.entradas - semana.salidas;
    if (saldo !== null && !Number.isSafeInteger(saldo)) throw new Error("centavos_invalidos");
    semana.saldoFinal = saldo;
  }

  const entradas = sumarCentavos(semanas.map((semana) => semana.entradas));
  const salidas = sumarCentavos(semanas.map((semana) => semana.salidas));
  const gastoNetoMensual = Math.round((salidas - entradas) / 3);

  return {
    hoy: fuentes.hoy,
    inicio,
    fin,
    corte,
    saldo: fuentes.saldo,
    colchonCentavos: fuentes.colchonCentavos,
    semanas,
    atrasados,
    entradas,
    salidas,
    comprometido4: sumarCentavos(semanas.slice(0, 4).map((semana) => semana.salidas)),
    entradas4: sumarCentavos(semanas.slice(0, 4).map((semana) => semana.entradas)),
    gastoNetoMensual,
    alcance: alcanceDe(fuentes.saldo, semanas, gastoNetoMensual),
    faltante: faltanteDe(semanas, fuentes.colchonCentavos),
    escenario: aplicado,
    movibles,
  };
}

function alcanceDe(saldo: SaldoDeclarado | null, semanas: readonly Semana[], gastoNetoMensual: number): Alcance {
  if (!saldo) return { tipo: "sin_saldo" };
  const primera = semanas.find((semana) => semana.saldoFinal !== null && semana.saldoFinal < 0);
  if (primera) return { tipo: "semanas", semanas: primera.indice };
  if (gastoNetoMensual <= 0) return { tipo: "holgado", meses: null };
  return { tipo: "holgado", meses: Math.floor((saldo.centavos * 10) / gastoNetoMensual) / 10 };
}

function faltanteDe(semanas: readonly Semana[], colchon: number): Faltante | null {
  const umbral = Math.max(0, colchon);
  for (const semana of semanas) {
    if (semana.saldoFinal === null) return null;
    const negativo = semana.saldoFinal < 0;
    if (negativo || (umbral > 0 && semana.saldoFinal < umbral)) {
      const causas = semana.movimientos
        .filter((movimiento) => movimiento.sentido === "salida")
        .sort((a, b) => b.centavos - a.centavos || a.clave.localeCompare(b.clave))
        .slice(0, 3);
      return {
        semana: semana.indice,
        inicio: semana.inicio,
        fin: semana.fin,
        saldoFinal: semana.saldoFinal,
        motivo: negativo ? "negativo" : "colchon",
        causas,
      };
    }
  }
  return null;
}

/** El escenario solo acepta un movimiento movible y una fecha entre hoy y el fin de la ventana. */
export function escenarioValido(
  proyeccion: Pick<Proyeccion, "movibles" | "hoy" | "fin">,
  clave: unknown,
  fecha: unknown,
): Escenario | null {
  if (typeof clave !== "string" || typeof fecha !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  try {
    exigirFecha(fecha);
  } catch {
    return null;
  }
  // Fuera de la ventana el pago desaparecería de la proyección: no es un escenario, es quitarlo.
  if (fecha < proyeccion.hoy || fecha > proyeccion.fin) return null;
  return proyeccion.movibles.some((movimiento) => movimiento.clave === clave) ? { clave, fecha } : null;
}

/**
 * Lo que provoca un faltante, en palabras: lo usan Inicio, Pendientes y el
 * correo de los lunes. La nómina reservada va sin monto, porque puede ser el
 * neto de una sola persona.
 */
export function textoDeCausas(causas: readonly Movimiento[]): string {
  return causas
    .map((m) => (m.reservado ? `${m.concepto} (monto reservado)` : `${m.concepto} (${formatoPesos(m.centavos)})`))
    .join(", ");
}

/** El alcance en palabras: lo usan Inicio y el correo de los lunes. */
export function textoAlcance(p: Pick<Proyeccion, "alcance">): string {
  if (p.alcance.tipo === "sin_saldo") return "Sin saldo declarado";
  if (p.alcance.tipo === "semanas") {
    return p.alcance.semanas === 0 ? "No alcanza esta semana" : `${p.alcance.semanas} ${p.alcance.semanas === 1 ? "semana" : "semanas"}`;
  }
  if (p.alcance.meses === null) return "Más de 13 semanas";
  return `Más de 13 semanas (≈ ${p.alcance.meses.toLocaleString("es-MX", { maximumFractionDigits: 1 })} meses al ritmo proyectado)`;
}
