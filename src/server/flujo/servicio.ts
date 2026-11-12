import { randomUUID } from "node:crypto";

import { formatoPesos } from "../../dominio/centavos";
import { leerCfdi } from "../../dominio/cfdi";
import {
  validarCobrado,
  validarCobroManual,
  validarColchon,
  validarFechaProbable,
  validarMotivo,
  validarObligacion,
  validarSaldo,
  textoLimpio,
  uuidValido,
  type CobroManual,
  type ErrorFlujo,
  type ObligacionEscrita,
} from "../../dominio/flujo/entradas";
import { desplazar, primeroDelMes, ultimoDelMes } from "../../dominio/flujo/fechas";
import { calcularPresupuestos, reservarNominaDeUnaPersona, type Presupuestos } from "../../dominio/flujo/presupuestos";
import { calcularRunway, horizonteDe, type Runway } from "../../dominio/flujo/runway";
import {
  corteDe,
  escenarioValido,
  movimientosEntre,
  nominaDeUnaPersona,
  proyectar,
  ventanaDe,
  type Escenario,
  type Faltante,
  type FuentesFlujo,
  type Movimiento,
  type OpcionesProyeccion,
  type Proyeccion,
} from "../../dominio/flujo/proyeccion";
import { hoyEnMexico } from "../../dominio/personas";
import { baseCliente, exigir, puede, type ContextoConEmpresa, type ContextoDeTenant } from "../../nucleo/contexto";
import { aplicarSentencia, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import {
  leerAreas,
  leerCobros,
  leerFuentes,
  leerFuentesPresupuesto,
  leerHistorialSaldo,
  leerObligaciones,
  leerPreferenciaCorreo,
  leerProveedoresConArea,
  leerSaldo,
  leerTotalesCobro,
  type CobroVista,
  type DeclaracionVista,
  type Fuentes,
  type ObligacionVista,
  type ProveedorConArea,
} from "./repositorio";

export type DependenciasFlujo = {
  ahora?: () => Date;
  auditar?: Auditar;
  /** La transacción de una escritura, con el contexto de la empresa. Por omisión, la de la base; las pruebas dan la suya. */
  transaccion?: <T>(ctx: ContextoConEmpresa, fn: (consulta: Consulta) => Promise<T>) => Promise<T>;
};

/** Un error de captura que vuelve al formulario con su campo. */
export class ErrorDeCaptura extends Error {
  constructor(readonly errores: ErrorFlujo[]) {
    super("captura_invalida");
  }
}

function hoyDe(deps?: DependenciasFlujo): string {
  return hoyEnMexico((deps?.ahora ?? (() => new Date()))());
}

function leerCon<T>(ctx: ContextoConEmpresa, fn: (consulta: Consulta) => Promise<T>): Promise<T> {
  return conContexto(baseCliente(ctx), fn);
}

// Lecturas -------------------------------------------------------------------------

export type FlujoInicio = {
  proyeccion: Proyeccion;
  /** La proyección real cuando la vista trae un escenario. */
  real: Proyeccion | null;
  presupuestos: Presupuestos;
  cobros: { porCobrar: number; vencidos: number; vencidosCentavos: number };
  puedeEditar: boolean;
  /** El runway conservador, con las mismas fuentes: Inicio lo dice cuando alcanza más de 13 semanas. */
  runway: Pick<Runway, "conservador">;
};

/**
 * Las fuentes de la proyección de una empresa. La consulta ya trae su contexto (RLS).
 * `hasta` alarga la lectura para el runway; la proyección de 13 semanas no la usa.
 */
export async function proyeccionCon(
  consulta: Consulta,
  empresaId: string,
  hoy: string,
  hasta: string = ventanaDe(hoy).fin,
): Promise<{ fuentes: FuentesFlujo; extra: Fuentes }> {
  const { saldo, colchonCentavos } = await leerSaldo(consulta, empresaId);
  const corte = corteDe({ hoy, saldo });
  const extra = await leerFuentes(consulta, empresaId, desplazar(corte, 1), hasta);
  return { fuentes: { hoy, saldo, colchonCentavos, ...extra }, extra };
}

/** Lo que Inicio muestra del flujo. El escenario recalcula sin escribir nada. */
export async function leerFlujoInicio(
  ctx: ContextoDeTenant | null | undefined,
  pedido: { mover?: unknown; fecha?: unknown } = {},
  deps?: DependenciasFlujo,
): Promise<FlujoInicio> {
  const conEmpresa = exigir(ctx, "cliente.flujo.ver");
  const hoy = hoyDe(deps);
  return leerCon(conEmpresa, async (consulta) => {
    const { fuentes } = await proyeccionCon(consulta, conEmpresa.empresa.id, hoy, horizonteDe(hoy).fin);
    const opciones = opcionesDeProyeccion(conEmpresa);
    const real = proyectar(fuentes, null, opciones);
    const escenario: Escenario | null = pedido.mover === undefined ? null : escenarioValido(real, pedido.mover, pedido.fecha);
    const presupuestos = presupuestosPara(
      conEmpresa,
      calcularPresupuestos(await leerFuentesPresupuesto(consulta, conEmpresa.empresa.id, hoy, primeroDelMes(hoy), ultimoDelMes(hoy))),
    );
    return {
      proyeccion: escenario ? proyectar(fuentes, escenario, opciones) : real,
      real: escenario ? real : null,
      presupuestos,
      cobros: await leerTotalesCobro(consulta, conEmpresa.empresa.id, hoy),
      puedeEditar: puede(conEmpresa, "cliente.flujo.editar"),
      runway: { conservador: calcularRunway(fuentes, [], opciones).conservador },
    };
  });
}

/** Sin cliente.nomina.detalle.ver, la proyección no desglosa la nómina de una sola persona. */
function opcionesDeProyeccion(ctx: ContextoConEmpresa): OpcionesProyeccion {
  return { detalleNomina: puede(ctx, "cliente.nomina.detalle.ver") };
}

export type FaltantePendientes = { faltante: Faltante; colchonCentavos: number };

/** Las fuentes de la proyección, leídas con el contexto de la empresa (RLS). */
function fuentesDeEmpresa(ctx: ContextoConEmpresa, hoy: string): Promise<FuentesFlujo> {
  return leerCon(ctx, async (consulta) => (await proyeccionCon(consulta, ctx.empresa.id, hoy)).fuentes);
}

/**
 * El faltante que Pendientes muestra es el mismo de Inicio: mismas fuentes y
 * misma proyección, con la nómina de una persona reservada a quien no ve su
 * detalle. Sin cliente.flujo.ver no se lee nada. Si el dinero alcanza, no hay alerta.
 */
export async function leerFaltante(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasFlujo & { fuentes?: (ctx: ContextoConEmpresa, hoy: string) => Promise<FuentesFlujo> },
): Promise<FaltantePendientes | null> {
  if (!puede(ctx, "cliente.flujo.ver")) return null;
  const conEmpresa = exigir(ctx, "cliente.flujo.ver");
  const fuentes = await (deps?.fuentes ?? fuentesDeEmpresa)(conEmpresa, hoyDe(deps));
  const { faltante, colchonCentavos } = proyectar(fuentes, null, opcionesDeProyeccion(conEmpresa));
  return faltante ? { faltante, colchonCentavos } : null;
}

/** El faltante para Pendientes, o «no_disponible» si la proyección falló. */
export type FaltanteDePendientes = FaltantePendientes | null | "no_disponible";

/**
 * Pendientes es la lista de trabajo: si la proyección falla, la bandeja se pinta
 * igual y la página avisa. El fallo queda registrado con su código y la
 * petición; nunca con el mensaje crudo, que puede traer la URL de la base.
 */
export async function leerFaltanteParaPendientes(
  ctx: ContextoDeTenant | null | undefined,
  deps?: Parameters<typeof leerFaltante>[1],
): Promise<FaltanteDePendientes> {
  try {
    return await leerFaltante(ctx, deps);
  } catch (error) {
    console.error(
      JSON.stringify({
        evento: "pendientes.faltante_no_disponible",
        codigo: error instanceof ErrorDeDominio ? error.codigo : error instanceof Error ? error.name : "desconocido",
        peticionId: ctx?.peticionId ?? null,
      }),
    );
    return "no_disponible";
  }
}

export type VistaSaldo = {
  hoy: string;
  /** El id de la próxima declaración: un envío repetido del formulario no crea otra. */
  altaId: string;
  historial: DeclaracionVista[];
  colchonCentavos: number;
  correoSemanal: boolean;
  puedeEditar: boolean;
};

/** Áreas para el campo opcional del alta de proveedores; lo ve quien puede dar de alta. */
export async function leerAreasParaProveedor(ctx: ContextoDeTenant | null | undefined): Promise<{ id: string; nombre: string }[]> {
  const conEmpresa = exigir(ctx, "cliente.proveedores.alta");
  return leerCon(conEmpresa, (consulta) => leerAreas(consulta, conEmpresa.empresa.id));
}

export async function leerVistaSaldo(ctx: ContextoDeTenant | null | undefined, deps?: DependenciasFlujo): Promise<VistaSaldo> {
  const conEmpresa = exigir(ctx, "cliente.flujo.ver");
  return leerCon(conEmpresa, async (consulta) => ({
    hoy: hoyDe(deps),
    altaId: idDeAlta(),
    historial: await leerHistorialSaldo(consulta, conEmpresa.empresa.id),
    colchonCentavos: (await leerSaldo(consulta, conEmpresa.empresa.id)).colchonCentavos,
    correoSemanal: await leerPreferenciaCorreo(consulta, conEmpresa.empresa.id, conEmpresa.persona.id),
    puedeEditar: puede(conEmpresa, "cliente.flujo.editar"),
  }));
}

export type VistaCobros = {
  hoy: string;
  /** Un id por formulario de alta (a mano y con XML). */
  altaIds: { manual: string; xml: string };
  cobros: CobroVista[];
  totales: { porCobrar: number; vencidos: number; vencidosCentavos: number };
  puedeEditar: boolean;
};

export async function leerVistaCobros(ctx: ContextoDeTenant | null | undefined, deps?: DependenciasFlujo): Promise<VistaCobros> {
  const conEmpresa = exigir(ctx, "cliente.flujo.ver");
  const hoy = hoyDe(deps);
  return leerCon(conEmpresa, async (consulta) => ({
    hoy,
    altaIds: { manual: idDeAlta(), xml: idDeAlta() },
    cobros: await leerCobros(consulta, conEmpresa.empresa.id),
    totales: await leerTotalesCobro(consulta, conEmpresa.empresa.id, hoy),
    puedeEditar: puede(conEmpresa, "cliente.flujo.editar"),
  }));
}

export type EventoCalendario = Movimiento & {
  vencido: boolean;
  /** Pago de nómina de una sola persona visto sin permiso de detalle: el monto no se muestra. */
  reservado: boolean;
  detalle: readonly (readonly [string, string])[];
};

/**
 * Sin permiso de ver el detalle de la nómina, un área cuya nómina del mes es de
 * una sola persona no muestra su gasto ni su desglose: solo estado y presupuesto.
 */
function presupuestosPara(ctx: ContextoConEmpresa, presupuestos: Presupuestos): Presupuestos {
  return puede(ctx, "cliente.nomina.detalle.ver") ? presupuestos : reservarNominaDeUnaPersona(presupuestos);
}

export type VistaCalendario = {
  hoy: string;
  mes: string;
  eventos: EventoCalendario[];
  proximos: EventoCalendario[];
  obligaciones: ObligacionVista[];
  areas: { id: string; nombre: string }[];
  proveedores: { id: string; nombre: string }[];
  /** El id de la próxima obligación. */
  altaId: string;
  puedeEditar: boolean;
};

const ESTADO_PAGO: Record<string, string> = {
  por_autorizar: "Por autorizar",
  listo_para_pagar: "Listo para pagar",
  sin_solicitud: "Sin solicitud",
};

function eventosDe(
  fuentes: FuentesFlujo,
  extra: Fuentes,
  desde: string,
  hasta: string,
  hoy: string,
  detalleNomina: boolean,
): EventoCalendario[] {
  const pagos = new Map(extra.pagos.map((pago) => [pago.id, pago]));
  const obligaciones = new Map(extra.obligaciones.map((obligacion) => [obligacion.id, obligacion]));
  const cobros = new Map(extra.cobros.map((cobro) => [cobro.id, cobro]));
  const cobrados = new Map(extra.cobrados.map((cobro) => [cobro.id, cobro]));
  return movimientosEntre(fuentes, desde, hasta).map((movimiento) => {
    const [, id] = movimiento.clave.split(":");
    const detalle: [string, string][] = [];
    if (movimiento.tipo === "proveedor") {
      const pago = pagos.get(id ?? "");
      if (pago) {
        detalle.push(["Proveedor", pago.proveedor], ["Referencia", pago.referencia], ["Vence", pago.venceEl], ["Estado", ESTADO_PAGO[pago.estado] ?? pago.estado]);
      }
    } else if (movimiento.tipo === "obligacion") {
      const obligacion = obligaciones.get(id ?? "");
      if (obligacion) {
        detalle.push(["Concepto", obligacion.concepto], ["Área", obligacion.areaNombre ?? "Sin área"]);
        detalle.push(["Proveedor", obligacion.proveedorNombre ?? "Sin proveedor: si llega como factura, ya cuenta en Pagos a proveedores"]);
        if (movimiento.facturadoCentavos) {
          detalle.push(["Ya facturado este mes", `${formatoPesos(movimiento.facturadoCentavos)}: cuenta en Pagos a proveedores, aquí solo lo que falta`]);
        }
      }
    } else if (movimiento.tipo === "cobro") {
      const cobro = movimiento.cobrado ? cobrados.get(id ?? "") : cobros.get(id ?? "");
      if (cobro) detalle.push(["Cliente", cobro.cliente], ["Concepto", cobro.concepto], ["Referencia", cobro.referencia ?? "Sin referencia"]);
      if (movimiento.cobrado) detalle.push(["Estado", "Cobrado"]);
    } else {
      detalle.push(["Origen", movimiento.clave.startsWith("lote:") ? "Lote ya preparado en Nómina" : "Calendario de nómina de las personas activas"]);
    }
    const vencido = movimiento.sentido === "entrada" && !movimiento.cobrado && movimiento.fecha < hoy;
    if (!detalleNomina && nominaDeUnaPersona(movimiento)) {
      // El neto de una sola persona: ni el monto ni el conteo.
      return {
        ...movimiento,
        concepto: "Nómina",
        centavos: 0,
        personas: undefined,
        vencido,
        reservado: true,
        detalle: [["Monto", "Solo lo ve quien puede ver el detalle de la nómina."]],
      };
    }
    return { ...movimiento, vencido, reservado: false, detalle };
  });
}

export async function leerVistaCalendario(
  ctx: ContextoDeTenant | null | undefined,
  mesPedido: unknown,
  deps?: DependenciasFlujo,
): Promise<VistaCalendario> {
  const conEmpresa = exigir(ctx, "cliente.flujo.ver");
  const hoy = hoyDe(deps);
  const mes = typeof mesPedido === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesPedido) ? `${mesPedido}-01` : primeroDelMes(hoy);
  const desde = mes;
  const hasta = ultimoDelMes(mes);
  const proximoFin = desplazar(hoy, 30);
  return leerCon(conEmpresa, async (consulta) => {
    const inicio = desde < hoy ? desde : hoy;
    const fin = hasta > proximoFin ? hasta : proximoFin;
    const extra = await leerFuentes(consulta, conEmpresa.empresa.id, inicio, fin);
    const fuentes: FuentesFlujo = { hoy, saldo: null, colchonCentavos: 0, ...extra };
    const detalleNomina = puede(conEmpresa, "cliente.nomina.detalle.ver");
    return {
      hoy,
      mes,
      eventos: eventosDe(fuentes, extra, desde, hasta, hoy, detalleNomina),
      proximos: eventosDe(fuentes, extra, hoy, proximoFin, hoy, detalleNomina),
      obligaciones: await leerObligaciones(consulta, conEmpresa.empresa.id),
      areas: await leerAreas(consulta, conEmpresa.empresa.id),
      proveedores: (await leerProveedoresConArea(consulta, conEmpresa.empresa.id)).map(({ id, nombre }) => ({ id, nombre })),
      altaId: idDeAlta(),
      puedeEditar: puede(conEmpresa, "cliente.flujo.editar"),
    };
  });
}

export type VistaPresupuestos = {
  hoy: string;
  presupuestos: Presupuestos;
  proveedores: ProveedorConArea[];
  areas: { id: string; nombre: string }[];
  puedeEditar: boolean;
};

export async function leerVistaPresupuestos(ctx: ContextoDeTenant | null | undefined, deps?: DependenciasFlujo): Promise<VistaPresupuestos> {
  const conEmpresa = exigir(ctx, "cliente.flujo.ver");
  const hoy = hoyDe(deps);
  return leerCon(conEmpresa, async (consulta) => ({
    hoy,
    presupuestos: presupuestosPara(
      conEmpresa,
      calcularPresupuestos(await leerFuentesPresupuesto(consulta, conEmpresa.empresa.id, hoy, primeroDelMes(hoy), ultimoDelMes(hoy))),
    ),
    proveedores: await leerProveedoresConArea(consulta, conEmpresa.empresa.id),
    areas: await leerAreas(consulta, conEmpresa.empresa.id),
    puedeEditar: puede(conEmpresa, "cliente.flujo.editar"),
  }));
}

/** Alertas de presupuesto para Pendientes: solo quien ve el flujo. */
export async function leerAlertasPresupuesto(ctx: ContextoConEmpresa, hoy: string): Promise<Presupuestos["alertas"]> {
  if (!puede(ctx, "cliente.flujo.ver")) return [];
  return leerCon(ctx, async (consulta) =>
    presupuestosPara(ctx, calcularPresupuestos(await leerFuentesPresupuesto(consulta, ctx.empresa.id, hoy, primeroDelMes(hoy), ultimoDelMes(hoy)))).alertas,
  );
}

// Escrituras -----------------------------------------------------------------------
// Cada una exige cliente.flujo.editar en el servidor, escribe y deja su evento en
// la misma transacción. La base vuelve a exigir el rol y el evento (0026).

function escribir<T>(
  ctx: ContextoDeTenant | null | undefined,
  deps: DependenciasFlujo | undefined,
  fn: (consulta: Consulta, conEmpresa: ContextoConEmpresa, auditar: Auditar, hoy: string) => Promise<T>,
): Promise<T> {
  const conEmpresa = exigir(ctx, "cliente.flujo.editar");
  return (deps?.transaccion ?? leerCon)(conEmpresa, (consulta) => fn(consulta, conEmpresa, deps?.auditar ?? auditarPorDefecto, hoyDe(deps)));
}

function exigirValido<T>(resultado: { ok: true; valor: T } | { ok: false; errores: ErrorFlujo[] }): T {
  if (!resultado.ok) throw new ErrorDeCaptura(resultado.errores);
  return resultado.valor;
}

/**
 * El id de una alta lo genera la página al pintar el formulario (campo oculto).
 * Un segundo envío del mismo formulario (doble clic, reintento de red) trae el
 * mismo id y los mismos datos: la fila ya existe y se responde igual, sin otra
 * fila ni otro evento. El mismo id con otros datos se rechaza
 * (formulario_ya_enviado): responder «quedó registrado» perdería los datos nuevos.
 */
function exigirAltaId(valor: unknown): string {
  if (!uuidValido(valor)) throw new ErrorDeDominio("entrada_invalida");
  return valor.toLowerCase();
}

type TablaDeAlta = "cash_balance_declarations" | "expected_collections" | "recurring_obligations";

/**
 * Lo que se compara de una alta repetida, por tabla: un SQL literal que lee la
 * fila de esta empresa con cada columna como texto (la regla de SQL del gate de
 * seguridad no deja armar la lista de columnas ni la tabla en el llamador).
 */
const SQL_ALTA_PREVIA = {
  cash_balance_declarations: `
    select saldo_centavos::text as saldo_centavos, to_char(al_dia, 'YYYY-MM-DD') as al_dia, declarado_por::text as declarado_por
      from cash_balance_declarations where id = $1 and company_id = $2`,
  expected_collections: `
    select origen, cliente_nombre, cliente_rfc, concepto, monto_centavos::text as monto_centavos,
           to_char(fecha_probable, 'YYYY-MM-DD') as fecha_probable, referencia, cfdi_uuid, creado_por::text as creado_por
      from expected_collections where id = $1 and company_id = $2`,
  recurring_obligations: `
    select concepto, monto_centavos::text as monto_centavos, frecuencia, to_char(proxima_fecha, 'YYYY-MM-DD') as proxima_fecha,
           ancla_dia::text as ancla_dia, cost_center_id::text as cost_center_id, supplier_id::text as supplier_id,
           creado_por::text as creado_por
      from recurring_obligations where id = $1 and company_id = $2`,
} as const;

/** Una columna de SQL_ALTA_PREVIA de esa tabla y el valor esperado como texto. */
type CampoDeAlta = readonly [columna: string, valor: string | null];

/**
 * ¿La alta con este id ya quedó? Solo cuenta si es de esta empresa (RLS y el
 * filtro): un id ajeno no se encuentra. Si quedó con otros datos, se rechaza.
 */
async function altaPrevia(consulta: Consulta, tabla: TablaDeAlta, id: string, empresaId: string, campos: readonly CampoDeAlta[]): Promise<boolean> {
  const params = [id, empresaId];
  let fila;
  switch (tabla) {
    case "cash_balance_declarations":
      fila = await aplicarSentencia(consulta, SQL_ALTA_PREVIA.cash_balance_declarations, params);
      break;
    case "expected_collections":
      fila = await aplicarSentencia(consulta, SQL_ALTA_PREVIA.expected_collections, params);
      break;
    case "recurring_obligations":
      fila = await aplicarSentencia(consulta, SQL_ALTA_PREVIA.recurring_obligations, params);
      break;
  }
  const previa = fila.rows[0] as Record<string, unknown> | undefined;
  if (!previa) return false;
  if (campos.some(([columna]) => !(columna in previa))) throw new ErrorDeDominio("base_no_disponible");
  if (campos.some(([columna, valor]) => (previa[columna] ?? null) !== valor)) throw new ErrorDeDominio("formulario_ya_enviado");
  return true;
}

/** Después de un ON CONFLICT (id) DO NOTHING: si no insertó, la fila tiene que ser de esta empresa y con los mismos datos. */
async function exigirAltaPropia(consulta: Consulta, tabla: TablaDeAlta, id: string, empresaId: string, campos: readonly CampoDeAlta[]): Promise<void> {
  if (!(await altaPrevia(consulta, tabla, id, empresaId, campos))) throw new ErrorDeDominio("entrada_invalida");
}

/** Pide un id nuevo para cada formulario de alta que pinta la página. */
export function idDeAlta(): string {
  return randomUUID();
}

export async function declararSaldo(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { saldo?: unknown; alDia?: unknown; altaId?: unknown },
  deps?: DependenciasFlujo,
): Promise<{ id: string }> {
  const conEmpresa = exigir(ctx, "cliente.flujo.editar");
  const valor = exigirValido(validarSaldo(entrada, hoyDe(deps)));
  const id = exigirAltaId(entrada.altaId);
  await escribir(conEmpresa, deps, async (consulta, c, auditar) => {
    const insertado = await aplicarSentencia(
      consulta,
      `insert into cash_balance_declarations (id, company_id, saldo_centavos, al_dia, declarado_por)
       values ($1, $2, $3, $4::date, $5)
       on conflict (id) do nothing
       returning id`,
      [id, c.empresa.id, valor.centavos, valor.alDia, c.persona.id],
    );
    if (insertado.rows.length === 0) {
      return exigirAltaPropia(consulta, "cash_balance_declarations", id, c.empresa.id, [
        ["saldo_centavos", String(valor.centavos)],
        ["al_dia", valor.alDia],
        ["declarado_por", c.persona.id.toLowerCase()],
      ]);
    }
    // El evento va después de la fila: el trigger diferido lo exige al confirmar, y un envío repetido no deja otro.
    await auditar(consulta, actorDeCliente(c), {
      accion: "declarar_saldo",
      identificador: id,
      cambio: { saldo_centavos: valor.centavos, al_dia: valor.alDia },
    });
  });
  return { id };
}

export async function configurarColchon(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { colchon?: unknown },
  deps?: DependenciasFlujo,
): Promise<void> {
  exigir(ctx, "cliente.flujo.editar");
  const colchon = exigirValido(validarColchon(entrada.colchon));
  await escribir(ctx, deps, async (consulta, c, auditar) => {
    const previo = await aplicarSentencia(consulta, "select colchon_centavos::text as c from cash_flow_settings where company_id = $1", [c.empresa.id]);
    const anterior = previo.rows[0] ? Number((previo.rows[0] as { c: string }).c) : null;
    await auditar(consulta, actorDeCliente(c), {
      accion: "configurar_colchon",
      identificador: c.empresa.id,
      cambio: { colchon_anterior: anterior, colchon_nuevo: colchon },
    });
    await aplicarSentencia(
      consulta,
      `insert into cash_flow_settings (company_id, colchon_centavos, actualizado_por)
       values ($1, $2, $3)
       on conflict (company_id) do update
         set colchon_centavos = excluded.colchon_centavos, actualizado_por = excluded.actualizado_por, actualizado_en = now()`,
      [c.empresa.id, colchon, c.persona.id],
    );
  });
}

/** Cada quien enciende o apaga su propio aviso. Basta ver el flujo. */
export async function cambiarCorreoSemanal(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { activo?: unknown },
  deps?: DependenciasFlujo,
): Promise<boolean> {
  const conEmpresa = exigir(ctx, "cliente.flujo.ver");
  if (entrada.activo !== "si" && entrada.activo !== "no") throw new ErrorDeDominio("entrada_invalida");
  const activo = entrada.activo === "si";
  await leerCon(conEmpresa, async (consulta) => {
    await (deps?.auditar ?? auditarPorDefecto)(consulta, actorDeCliente(conEmpresa), {
      accion: "preferencia_correo_semanal",
      identificador: conEmpresa.persona.id,
      cambio: { activo },
    });
    await aplicarSentencia(
      consulta,
      `insert into weekly_digest_preferences (company_id, user_id, activo)
       values ($1, $2, $3)
       on conflict (company_id, user_id) do update set activo = excluded.activo, actualizado_en = now()`,
      [conEmpresa.empresa.id, conEmpresa.persona.id, activo],
    );
  });
  return activo;
}

type CobroAlta = CobroManual & { origen: "manual" | "cfdi"; cfdiUuid: string | null };

function camposDeCobro(cobro: CobroAlta, personaId: string): CampoDeAlta[] {
  return [
    ["origen", cobro.origen],
    ["cliente_nombre", cobro.clienteNombre],
    ["cliente_rfc", cobro.clienteRfc],
    ["concepto", cobro.concepto],
    ["monto_centavos", String(cobro.montoCentavos)],
    ["fecha_probable", cobro.fechaProbable],
    ["referencia", cobro.referencia],
    ["cfdi_uuid", cobro.cfdiUuid],
    ["creado_por", personaId.toLowerCase()],
  ];
}

/**
 * La misma factura en otro cobro vivo de la empresa: el rechazo dice en qué estado está. Sin otro cobro vivo, no hace nada.
 * La fila de esta misma alta no cuenta: si el primer envío del formulario confirmó entre `altaPrevia` y esta lectura,
 * el segundo sigue al insert, choca con el id y `altaPrevia` le responde igual.
 */
async function rechazarFacturaViva(consulta: Consulta, empresaId: string, cfdiUuid: string, altaId: string): Promise<void> {
  const previo = await aplicarSentencia(
    consulta,
    `select estado from expected_collections
      where company_id = $1 and cfdi_uuid = $2 and estado <> 'cancelado' and id <> $3
      limit 1`,
    [empresaId, cfdiUuid, altaId],
  );
  const estado = (previo.rows[0] as { estado?: unknown } | undefined)?.estado;
  if (estado === "cobrado") throw new ErrorDeDominio("cobro_ya_cobrado");
  if (estado === "esperado") throw new ErrorDeDominio("cobro_duplicado");
}

async function insertarCobro(
  consulta: Consulta,
  c: ContextoConEmpresa,
  auditar: Auditar,
  id: string,
  cobro: CobroAlta,
): Promise<void> {
  const insertado = await aplicarSentencia(
    consulta,
    `insert into expected_collections
       (id, company_id, origen, cliente_nombre, cliente_rfc, concepto, monto_centavos, fecha_probable, referencia, cfdi_uuid, creado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11)
     on conflict do nothing
     returning id`,
    [id, c.empresa.id, cobro.origen, cobro.clienteNombre, cobro.clienteRfc, cobro.concepto, cobro.montoCentavos,
      cobro.fechaProbable, cobro.referencia, cobro.cfdiUuid, c.persona.id],
  );
  // Sin columna en ON CONFLICT: dos envíos simultáneos del mismo XML chocan con el id o con la factura viva
  // (índice parcial), según cuál revise primero Postgres. Si no insertó, o es el mismo formulario o es otra alta de esa factura.
  if (insertado.rows.length === 0) {
    if (await altaPrevia(consulta, "expected_collections", id, c.empresa.id, camposDeCobro(cobro, c.persona.id))) return;
    if (cobro.cfdiUuid) await rechazarFacturaViva(consulta, c.empresa.id, cobro.cfdiUuid, id);
    throw new ErrorDeDominio("entrada_invalida");
  }
  await auditar(consulta, actorDeCliente(c), {
    accion: "registrar_cobro",
    identificador: id,
    cambio: { origen: cobro.origen, monto_centavos: cobro.montoCentavos, fecha_probable: cobro.fechaProbable },
  });
}

export async function registrarCobro(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  deps?: DependenciasFlujo,
): Promise<{ id: string }> {
  exigir(ctx, "cliente.flujo.editar");
  const cobro = exigirValido(validarCobroManual(entrada));
  const id = exigirAltaId(entrada.altaId);
  await escribir(ctx, deps, (consulta, c, auditar) =>
    insertarCobro(consulta, c, auditar, id, { ...cobro, origen: "manual", cfdiUuid: null }));
  return { id };
}

const MENSAJE_CFDI: Record<string, string> = {
  cfdi_invalido: "El archivo no es un XML de CFDI válido.",
  cfdi_codificacion: "El XML no está en UTF-8.",
  cfdi_contenido_no_permitido: "El XML trae contenido que no se acepta (scripts, XHTML o SVG).",
  cfdi_no_es_ingreso_mxn: "Solo se registran facturas de ingreso CFDI 4.0 en pesos.",
  cfdi_datos_incompletos: "Al XML le faltan datos: UUID, RFC, nombres, total o fecha.",
};

/**
 * Alta con el XML de una factura emitida. El lector es el mismo de
 * proveedores (`leerCfdi`), que ya rechaza XHTML, SVG y scripts. La factura
 * tiene que haberla emitido esta empresa: el RFC emisor es el de la empresa.
 */
export async function registrarCobroCfdi(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { bytes: Uint8Array | null; fechaProbable?: unknown; concepto?: unknown; altaId?: unknown },
  deps?: DependenciasFlujo,
): Promise<{ id: string; cliente: string; montoCentavos: number }> {
  const conEmpresa = exigir(ctx, "cliente.flujo.editar");
  const id = exigirAltaId(entrada.altaId);
  const errores: ErrorFlujo[] = [];
  const fecha = validarFechaProbable(entrada.fechaProbable);
  if (!fecha.ok) errores.push(...fecha.errores);
  if (!entrada.bytes || entrada.bytes.byteLength === 0) {
    errores.push({ campo: "xml", mensaje: "Elige el XML de la factura emitida." });
    throw new ErrorDeCaptura(errores);
  }
  const leido = leerCfdi(entrada.bytes);
  if (!leido.ok) {
    errores.push({ campo: "xml", mensaje: MENSAJE_CFDI[leido.codigo] ?? MENSAJE_CFDI.cfdi_invalido! });
    throw new ErrorDeCaptura(errores);
  }
  const cfdi = leido.cfdi;
  if (cfdi.rfcEmisor !== conEmpresa.empresa.rfc.toUpperCase()) {
    errores.push({
      campo: "xml",
      mensaje: `Esta factura la emitió el RFC ${cfdi.rfcEmisor}, no ${conEmpresa.empresa.rfc}. Solo se registran facturas que emitió ${conEmpresa.empresa.razonSocial}.`,
    });
  }
  const conceptoEscrito = typeof entrada.concepto === "string" ? entrada.concepto.trim() : "";
  const concepto = conceptoEscrito === "" ? `Factura ${cfdi.referencia}` : textoLimpio(conceptoEscrito, 200);
  if (!concepto) errores.push({ campo: "conceptoXml", mensaje: "El concepto admite hasta 200 caracteres." });
  if (errores.length > 0 || !fecha.ok || !concepto) throw new ErrorDeCaptura(errores);
  const cobro: CobroAlta = {
    origen: "cfdi",
    cfdiUuid: cfdi.uuid,
    clienteNombre: cfdi.nombreReceptor.slice(0, 254),
    clienteRfc: cfdi.rfcReceptor,
    concepto,
    montoCentavos: cfdi.totalCentavos,
    fechaProbable: fecha.valor,
    referencia: cfdi.referencia.slice(0, 120),
  };
  await escribir(conEmpresa, deps, async (consulta, c, auditar) => {
    // Un segundo envío del mismo formulario ya encuentra su fila: se responde igual (o se rechaza si trae otra factura).
    if (await altaPrevia(consulta, "expected_collections", id, c.empresa.id, camposDeCobro(cobro, c.persona.id))) return;
    // La misma factura en otro cobro vivo: el mensaje dice en qué estado está.
    await rechazarFacturaViva(consulta, c.empresa.id, cfdi.uuid, id);
    await insertarCobro(consulta, c, auditar, id, cobro);
  });
  return { id, cliente: cfdi.nombreReceptor, montoCentavos: cfdi.totalCentavos };
}

export async function marcarCobrado(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { id?: unknown; cobradoEl?: unknown },
  deps?: DependenciasFlujo,
): Promise<void> {
  exigir(ctx, "cliente.flujo.editar");
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("cobro_ausente");
  const id = entrada.id;
  const cobradoEl = exigirValido(validarCobrado(entrada.cobradoEl, hoyDe(deps)));
  await escribir(ctx, deps, async (consulta, c, auditar) => {
    await auditar(consulta, actorDeCliente(c), { accion: "cobrar_cobro", identificador: id, cambio: { cobrado_el: cobradoEl } });
    const hecho = await aplicarSentencia(
      consulta,
      `update expected_collections
          set estado = 'cobrado', cobrado_el = $3::date, resuelto_por = $4, resuelto_en = now()
        where company_id = $1 and id = $2 and estado = 'esperado'`,
      [c.empresa.id, id, cobradoEl, c.persona.id],
    );
    if (hecho.rowCount !== 1) throw new ErrorDeDominio("cobro_ya_resuelto");
  });
}

export async function cancelarCobro(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { id?: unknown; motivo?: unknown },
  deps?: DependenciasFlujo,
): Promise<void> {
  exigir(ctx, "cliente.flujo.editar");
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("cobro_ausente");
  const id = entrada.id;
  const motivo = exigirValido(validarMotivo(entrada.motivo));
  await escribir(ctx, deps, async (consulta, c, auditar) => {
    await auditar(consulta, actorDeCliente(c), { accion: "cancelar_cobro", identificador: id, motivo });
    const hecho = await aplicarSentencia(
      consulta,
      `update expected_collections
          set estado = 'cancelado', motivo_cancelacion = $3, resuelto_por = $4, resuelto_en = now()
        where company_id = $1 and id = $2 and estado = 'esperado'`,
      [c.empresa.id, id, motivo, c.persona.id],
    );
    if (hecho.rowCount !== 1) throw new ErrorDeDominio("cobro_ya_resuelto");
  });
}

async function nombreDeArea(consulta: Consulta, empresaId: string, areaId: string | null): Promise<string | null> {
  if (!areaId) return null;
  const fila = await aplicarSentencia(consulta, "select nombre from cost_centers where company_id = $1 and id = $2", [empresaId, areaId]);
  const nombre = (fila.rows[0] as { nombre?: unknown } | undefined)?.nombre;
  if (typeof nombre !== "string") throw new ErrorDeDominio("area_ajena");
  return nombre;
}

async function nombreDeProveedor(consulta: Consulta, empresaId: string, proveedorId: string | null): Promise<string | null> {
  if (!proveedorId) return null;
  const fila = await aplicarSentencia(
    consulta,
    "select coalesce(nombre_comercial, razon_social) as nombre from suppliers where company_id = $1 and id = $2",
    [empresaId, proveedorId],
  );
  const nombre = (fila.rows[0] as { nombre?: unknown } | undefined)?.nombre;
  if (typeof nombre !== "string") throw new ErrorDeDominio("proveedor_ausente");
  return nombre;
}

export async function registrarObligacion(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  deps?: DependenciasFlujo,
): Promise<{ id: string }> {
  exigir(ctx, "cliente.flujo.editar");
  const valor: ObligacionEscrita = exigirValido(validarObligacion(entrada));
  const id = exigirAltaId(entrada.altaId);
  await escribir(ctx, deps, async (consulta, c, auditar) => {
    const area = await nombreDeArea(consulta, c.empresa.id, valor.areaId);
    const proveedor = await nombreDeProveedor(consulta, c.empresa.id, valor.proveedorId);
    const insertado = await aplicarSentencia(
      consulta,
      `insert into recurring_obligations
         (id, company_id, concepto, monto_centavos, frecuencia, proxima_fecha, ancla_dia, cost_center_id, supplier_id, creado_por, actualizado_por)
       values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $10)
       on conflict (id) do nothing
       returning id`,
      [id, c.empresa.id, valor.concepto, valor.montoCentavos, valor.frecuencia, valor.proximaFecha, valor.anclaDia, valor.areaId,
        valor.proveedorId, c.persona.id],
    );
    if (insertado.rows.length === 0) {
      return exigirAltaPropia(consulta, "recurring_obligations", id, c.empresa.id, [
        ["concepto", valor.concepto],
        ["monto_centavos", String(valor.montoCentavos)],
        ["frecuencia", valor.frecuencia],
        ["proxima_fecha", valor.proximaFecha],
        ["ancla_dia", String(valor.anclaDia)],
        ["cost_center_id", valor.areaId?.toLowerCase() ?? null],
        ["supplier_id", valor.proveedorId?.toLowerCase() ?? null],
        ["creado_por", c.persona.id.toLowerCase()],
      ]);
    }
    await auditar(consulta, actorDeCliente(c), {
      accion: "registrar_obligacion",
      identificador: id,
      cambio: {
        concepto: valor.concepto,
        monto_centavos: valor.montoCentavos,
        frecuencia: valor.frecuencia,
        proxima_fecha: valor.proximaFecha,
        area: area,
        proveedor: proveedor,
      },
    });
  });
  return { id };
}

export async function editarObligacion(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  deps?: DependenciasFlujo,
): Promise<void> {
  exigir(ctx, "cliente.flujo.editar");
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("obligacion_ausente");
  const id = entrada.id;
  const valor = exigirValido(validarObligacion(entrada));
  await escribir(ctx, deps, async (consulta, c, auditar) => {
    const areaNueva = await nombreDeArea(consulta, c.empresa.id, valor.areaId);
    const proveedorNuevo = await nombreDeProveedor(consulta, c.empresa.id, valor.proveedorId);
    const previo = await aplicarSentencia(
      consulta,
      `select o.concepto, o.monto_centavos::text as monto, o.frecuencia, to_char(o.proxima_fecha, 'YYYY-MM-DD') as fecha,
              a.nombre as area, coalesce(s.nombre_comercial, s.razon_social) as proveedor
         from recurring_obligations o
         left join cost_centers a on a.id = o.cost_center_id and a.company_id = o.company_id
         left join suppliers s on s.id = o.supplier_id and s.company_id = o.company_id
        where o.company_id = $1 and o.id = $2 and o.activa
        for update of o`,
      [c.empresa.id, id],
    );
    const fila = previo.rows[0] as
      | { concepto: string; monto: string; frecuencia: string; fecha: string; area: string | null; proveedor: string | null }
      | undefined;
    if (!fila) throw new ErrorDeDominio("obligacion_inactiva");
    // Antes y después de todo lo que se puede cambiar; área y proveedor por nombre.
    await auditar(consulta, actorDeCliente(c), {
      accion: "editar_obligacion",
      identificador: id,
      cambio: {
        concepto_anterior: fila.concepto,
        concepto_nuevo: valor.concepto,
        monto_anterior: Number(fila.monto),
        monto_nuevo: valor.montoCentavos,
        frecuencia_anterior: fila.frecuencia,
        frecuencia_nueva: valor.frecuencia,
        fecha_anterior: fila.fecha,
        fecha_nueva: valor.proximaFecha,
        area_anterior: fila.area ?? null,
        area_nueva: areaNueva,
        proveedor_anterior: fila.proveedor ?? null,
        proveedor_nuevo: proveedorNuevo,
      },
    });
    await aplicarSentencia(
      consulta,
      `update recurring_obligations
          set concepto = $3, monto_centavos = $4, frecuencia = $5, proxima_fecha = $6::date, ancla_dia = $7,
              cost_center_id = $8, supplier_id = $9, actualizado_por = $10, actualizado_en = now()
        where company_id = $1 and id = $2 and activa`,
      [c.empresa.id, id, valor.concepto, valor.montoCentavos, valor.frecuencia, valor.proximaFecha, valor.anclaDia, valor.areaId,
        valor.proveedorId, c.persona.id],
    );
  });
}

export async function desactivarObligacion(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { id?: unknown },
  deps?: DependenciasFlujo,
): Promise<void> {
  exigir(ctx, "cliente.flujo.editar");
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("obligacion_ausente");
  const id = entrada.id;
  await escribir(ctx, deps, async (consulta, c, auditar) => {
    await auditar(consulta, actorDeCliente(c), { accion: "desactivar_obligacion", identificador: id });
    const hecho = await aplicarSentencia(
      consulta,
      `update recurring_obligations set activa = false, actualizado_por = $3, actualizado_en = now()
        where company_id = $1 and id = $2 and activa`,
      [c.empresa.id, id, c.persona.id],
    );
    if (hecho.rowCount !== 1) throw new ErrorDeDominio("obligacion_inactiva");
  });
}

/** El único cambio a un proveedor desde el flujo: su área, para sumar sus pagos al presupuesto. */
export async function asignarAreaProveedor(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { proveedorId?: unknown; areaId?: unknown },
  deps?: DependenciasFlujo,
): Promise<void> {
  exigir(ctx, "cliente.flujo.editar");
  if (!uuidValido(entrada.proveedorId)) throw new ErrorDeDominio("proveedor_ausente");
  const proveedorId = entrada.proveedorId;
  const areaEscrita = typeof entrada.areaId === "string" ? entrada.areaId.trim() : "";
  if (areaEscrita !== "" && !uuidValido(areaEscrita)) throw new ErrorDeDominio("area_ajena");
  const areaId = areaEscrita === "" ? null : areaEscrita.toLowerCase();
  await escribir(ctx, deps, async (consulta, c, auditar) => {
    const previo = await aplicarSentencia(
      consulta,
      `select s.cost_center_id, a.nombre from suppliers s
         left join cost_centers a on a.id = s.cost_center_id and a.company_id = s.company_id
        where s.company_id = $1 and s.id = $2 for update of s`,
      [c.empresa.id, proveedorId],
    );
    const fila = previo.rows[0] as { cost_center_id: string | null; nombre: string | null } | undefined;
    if (!fila) throw new ErrorDeDominio("proveedor_ausente");
    if ((fila.cost_center_id ?? null) === areaId) return;
    const nueva = await nombreDeArea(consulta, c.empresa.id, areaId);
    await auditar(consulta, actorDeCliente(c), {
      accion: "asignar_area_proveedor",
      identificador: proveedorId,
      cambio: { area_anterior: fila.nombre ?? null, area_nueva: nueva },
    });
    await aplicarSentencia(
      consulta,
      "update suppliers set cost_center_id = $3 where company_id = $1 and id = $2",
      [c.empresa.id, proveedorId, areaId],
    );
  });
}
