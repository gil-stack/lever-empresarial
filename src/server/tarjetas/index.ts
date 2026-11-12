
import { baseCliente, exigirEmpresa, puede, type ContextoConEmpresa, type ContextoDeTenant } from "@/nucleo/contexto";
import { conContexto, type Consulta } from "@/nucleo/db";
import { ErrorDeDominio } from "@/nucleo/error-de-dominio";
import {
  ESTADOS_OPERACION,
  ESTADOS_TARJETA,
  TIPOS_OPERACION_TARJETA,
  type EstadoOperacion,
  type EstadoTarjeta,
  type MovimientoTarjeta,
  type OperacionTarjeta,
  type SaldoEmpresa,
  type TarjetaEmpresa,
  type TarjetasEmpresa,
  type TipoOperacionTarjeta,
} from "@/dominio/tarjetas/vista";
import { clienteHttpEfevoo, type ClienteEfevoo } from "@/server/efevoo/cliente";
import { configEfevoo } from "@/server/efevoo/config";
import { esErrorEfevoo } from "@/server/efevoo/errores";
import {
  conciliarOperacionEfevoo,
  ejecutarOperacionEfevoo,
  llamadaEstandar,
  reintentarOperacionEfevoo,
  type DependenciasOperacion,
  type OperacionEfevoo,
} from "@/server/efevoo/operaciones";
import { registrarEfevoo } from "@/server/efevoo/registros";

/**
 * Tarjetas de la empresa con Efevoo Pay. Cada operación que mueve dinero o cambia una tarjeta se asienta primero en la
 * base (pendiente, con su referencia y la llave de intento del formulario) y solo después se llama a Efevoo; un
 * timeout, un 5xx o una respuesta ilegible la dejan incierta, sin reintento automático, hasta conciliarla.
 *
 * Aquí viven la forma del servicio y los permisos. La conexión con el cliente de Efevoo y la 0033 llega con la base de
 * Efevoo (E1): mientras tanto ninguna empresa está vinculada y Tarjetas se ve como hoy.
 */

export type ResultadoOperacion = { readonly operacion: OperacionTarjeta; readonly existente: boolean };

/** Quien abre Tarjetas en la consola: administración, liberación y finanzas. */
function exigirVer(ctx: ContextoDeTenant | null): ContextoConEmpresa {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.tarjetas.ver")) throw new ErrorDeDominio("sin_permiso");
  return conEmpresa;
}

/** Cargar, retirar, bloquear y desbloquear: administración y liberación. El servidor lo exige aunque la pantalla no lo ofrezca. */
export function exigirOperar(ctx: ContextoDeTenant | null): ContextoConEmpresa {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.tarjetas.operar")) throw new ErrorDeDominio("sin_permiso");
  return conEmpresa;
}

/** El emisor: el cliente de Efevoo de la configuración vigente, o nulo sin configuración (Tarjetas sigue como antes). */
export type DepsTarjetas = { readonly cliente?: ClienteEfevoo | null };

function clienteDe(deps: DepsTarjetas): ClienteEfevoo | null {
  if (deps.cliente !== undefined) return deps.cliente;
  const config = configEfevoo();
  return config ? clienteHttpEfevoo(config) : null;
}

const TIPOS_DE_LA_EMPRESA: readonly string[] = TIPOS_OPERACION_TARJETA;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FilaTarjeta = { id: string; id_efevoo: number; terminacion: string; nombre_tarjeta: string; estado: string; titular: string | null };
type FilaOperacion = {
  id: string; tipo: string; monto_centavos: string | null; estado: string; referencia: string; creada_en: string;
  codigo_efevoo: string | null; reintento_de: string | null; terminacion: string;
};

function estadoTarjeta(v: string): EstadoTarjeta {
  if ((ESTADOS_TARJETA as readonly string[]).includes(v)) return v as EstadoTarjeta;
  throw new ErrorDeDominio("base_no_disponible");
}

function operacion(f: FilaOperacion): OperacionTarjeta & { terminacion: string } {
  if (!(ESTADOS_OPERACION as readonly string[]).includes(f.estado) || !TIPOS_DE_LA_EMPRESA.includes(f.tipo)) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: f.id,
    tipo: f.tipo as TipoOperacionTarjeta,
    montoCentavos: f.monto_centavos === null ? null : Number(f.monto_centavos),
    estado: f.estado as EstadoOperacion,
    referencia: f.referencia,
    creadaEn: new Date(f.creada_en).toISOString(),
    codigoEfevoo: f.codigo_efevoo,
    reintentoDe: f.reintento_de,
    buscadaSinEncontrar: f.estado === "fallida" && f.codigo_efevoo === "no_aparecio",
    terminacion: f.terminacion,
  };
}

const COLUMNAS_TARJETA = `t.id, t.id_efevoo, t.terminacion, t.nombre_tarjeta, t.estado, e.nombre as titular`;
const DESDE_TARJETAS = `efevoo_tarjetas t left join employees e on e.id = t.employee_id and e.company_id = t.company_id`;
const COLUMNAS_OPERACION = `o.id, o.tipo, o.monto_centavos::text, o.estado, o.referencia, o.creada_en, o.codigo_efevoo, o.reintento_de, t.terminacion`;

async function vinculada(consulta: Consulta): Promise<boolean> {
  const r = await consulta.query("select idep_cliente from efevoo_clientes where company_id = app_empresa()");
  return r.rows.length === 1;
}

async function idepDe(consulta: Consulta): Promise<number | null> {
  const r = await consulta.query("select idep_cliente from efevoo_clientes where company_id = app_empresa()");
  const id = (r.rows[0] as { idep_cliente?: number } | undefined)?.idep_cliente;
  return typeof id === "number" ? id : null;
}

/** El saldo de la empresa en el emisor; si no responde, «no disponible» (la pantalla lo dice y no inventa cifras). */
export async function saldoEmpresa(cliente: ClienteEfevoo, idep: number): Promise<SaldoEmpresa> {
  try {
    const c = await cliente.leerCliente(idep);
    return c.saldoCentavos === null ? { tipo: "no_disponible" } : { tipo: "listo", centavos: c.saldoCentavos };
  } catch (error) {
    // Solo lo que dice el emisor se vuelve «no disponible»; un error del programa se ve (r-e2-6).
    if (!esErrorEfevoo(error)) throw error;
    registrarEfevoo("error", "tarjetas_saldo_empresa_no_disponible", {});
    return { tipo: "no_disponible" };
  }
}

/**
 * El saldo de cada tarjeta (getCardsBalance lo da por terminación). Si dos tarjetas comparten terminación o el emisor
 * no responde, ese saldo queda desconocido: mejor un «—» que la cifra de otra tarjeta.
 */
export async function saldosDeTarjetas(cliente: ClienteEfevoo, tarjetas: readonly FilaTarjeta[]): Promise<Map<string, number | null>> {
  const vivas = tarjetas.filter((t) => t.estado !== "cancelada");
  const saldos = new Map<string, number | null>();
  if (vivas.length === 0) return saldos;
  try {
    const leidos = await cliente.saldoDeTarjetas(vivas.map((t) => t.id_efevoo));
    const repetidas = new Set(vivas.map((t) => t.terminacion).filter((x, i, todas) => todas.indexOf(x) !== i));
    for (const l of leidos) saldos.set(l.terminacion, repetidas.has(l.terminacion) ? null : l.saldoCentavos);
  } catch (error) {
    if (!esErrorEfevoo(error)) throw error;
    registrarEfevoo("error", "tarjetas_saldo_no_disponible", {});
  }
  return saldos;
}

function tarjetaDe(f: FilaTarjeta, saldos: Map<string, number | null>): TarjetaEmpresa {
  return {
    id: f.id,
    terminacion: f.terminacion,
    nombre: f.nombre_tarjeta,
    titular: f.titular,
    estado: estadoTarjeta(f.estado),
    saldoCentavos: f.estado === "cancelada" ? null : saldos.get(f.terminacion) ?? null,
  };
}

/** Los movimientos de una tarjeta: el correo del titular se pide al emisor y solo vive en memoria. Nulo si no responde. */
export async function movimientosDe(cliente: ClienteEfevoo, idEfevoo: number): Promise<readonly MovimientoTarjeta[] | null> {
  try {
    const correo = await cliente.correoDeTarjeta(idEfevoo);
    if (!correo) {
      registrarEfevoo("error", "tarjetas_movimientos_sin_correo", {});
      return null;
    }
    const movimientos = await cliente.movimientosDeTarjeta(idEfevoo, correo);
    return movimientos.slice(0, 50).map((m) => ({ fecha: m.fechaHora, concepto: m.concepto, montoCentavos: m.centavos }));
  } catch (error) {
    if (!esErrorEfevoo(error)) throw error;
    registrarEfevoo("error", "tarjetas_movimientos_no_disponibles", {});
    return null;
  }
}

/** Las tarjetas de la empresa, su saldo en Efevoo y lo que pide atención; nulo si la empresa no está vinculada. */
export async function leerTarjetasEmpresa(ctx: ContextoDeTenant | null, deps: DepsTarjetas = {}): Promise<TarjetasEmpresa | null> {
  const conEmpresa = exigirVer(ctx);
  const cliente = clienteDe(deps);
  if (!cliente) return null;
  const leido = await conContexto(baseCliente(conEmpresa), async (consulta) => {
    const idep = await idepDe(consulta);
    if (idep === null) return null;
    const tarjetas = (await consulta.query(
      `select ${COLUMNAS_TARJETA} from ${DESDE_TARJETAS} where t.company_id = app_empresa()
        order by (t.estado = 'cancelada'), t.creada_en, t.id`,
    )).rows as FilaTarjeta[];
    // Por confirmar: pendientes, inciertas y las que no aparecieron en el emisor y todavía no se reintentan.
    const porAtender = (await consulta.query(
      `select ${COLUMNAS_OPERACION} from efevoo_operaciones o join efevoo_tarjetas t on t.id = o.tarjeta_id and t.company_id = o.company_id
        where o.company_id = app_empresa() and o.tipo = any($1::text[])
          and (o.estado in ('pendiente', 'incierta')
               or (o.estado = 'fallida' and o.codigo_efevoo = 'no_aparecio'
                   and not exists (select 1 from efevoo_operaciones r where r.reintento_de = o.id)))
        order by o.creada_en desc limit 50`,
      [TIPOS_DE_LA_EMPRESA],
    )).rows as FilaOperacion[];
    return { idep, tarjetas, porAtender };
  });
  if (!leido) return null;
  const [saldo, saldos] = await Promise.all([saldoEmpresa(cliente, leido.idep), saldosDeTarjetas(cliente, leido.tarjetas)]);
  return { saldo, tarjetas: leido.tarjetas.map((t) => tarjetaDe(t, saldos)), porAtender: leido.porAtender.map(operacion) };
}

export type TarjetaDelTitular = { readonly tarjeta: TarjetaEmpresa; readonly movimientos: readonly MovimientoTarjeta[] | null };

/**
 * Las tarjetas del titular en el teléfono: solo las suyas (la RLS de la 0033 deja ver al empleado con `user_id` igual
 * al de la sesión), con su saldo y sus movimientos. Nulo si la empresa no está vinculada a Efevoo.
 */
export async function leerMisTarjetas(ctx: ContextoDeTenant | null, deps: DepsTarjetas = {}): Promise<readonly TarjetaDelTitular[] | null> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "telefono.tarjetas.ver")) throw new ErrorDeDominio("sin_permiso");
  const cliente = clienteDe(deps);
  if (!cliente) return null;
  // Solo las del empleado ligado a la sesión, aunque la persona tenga además un rol que vea todas.
  const tarjetas = await conContexto(baseCliente(conEmpresa), async (consulta) => {
    if (!(await vinculada(consulta))) return null;
    return (await consulta.query(
      `select ${COLUMNAS_TARJETA} from ${DESDE_TARJETAS}
        where t.company_id = app_empresa() and e.user_id = app_usuario() and t.estado <> 'cancelada'
        order by t.creada_en, t.id`,
    )).rows as FilaTarjeta[];
  });
  if (!tarjetas) return null;
  const saldos = await saldosDeTarjetas(cliente, tarjetas);
  return Promise.all(tarjetas.map(async (t) => ({ tarjeta: tarjetaDe(t, saldos), movimientos: await movimientosDe(cliente, t.id_efevoo) })));
}

export type DetalleTarjeta = {
  readonly tarjeta: TarjetaEmpresa;
  /** El saldo de la empresa en el emisor: cargar avisa antes si no alcanza. */
  readonly saldoEmpresa: SaldoEmpresa;
  /** Los movimientos en Efevoo, del más nuevo al más viejo; nulo si el emisor no respondió. */
  readonly movimientos: readonly MovimientoTarjeta[] | null;
  /** Lo que Lever le pidió al emisor sobre esta tarjeta, con su estado. */
  readonly operaciones: readonly OperacionTarjeta[];
};

/** Una tarjeta de la empresa con sus movimientos y operaciones; nulo si no es de esta empresa (la página da 404). */
export async function leerDetalleTarjeta(ctx: ContextoDeTenant | null, tarjetaId: string, deps: DepsTarjetas = {}): Promise<DetalleTarjeta | null> {
  const conEmpresa = exigirVer(ctx);
  if (!UUID.test(tarjetaId)) return null;
  const cliente = clienteDe(deps);
  if (!cliente) return null;
  const leido = await conContexto(baseCliente(conEmpresa), async (consulta) => {
    const idep = await idepDe(consulta);
    if (idep === null) return null;
    const fila = (await consulta.query(`select ${COLUMNAS_TARJETA} from ${DESDE_TARJETAS} where t.id = $1 and t.company_id = app_empresa()`, [tarjetaId]))
      .rows[0] as FilaTarjeta | undefined;
    if (!fila) return null;
    const operaciones = (await consulta.query(
      `select ${COLUMNAS_OPERACION} from efevoo_operaciones o join efevoo_tarjetas t on t.id = o.tarjeta_id and t.company_id = o.company_id
        where o.tarjeta_id = $1 and o.company_id = app_empresa() and o.tipo = any($2::text[])
        order by o.creada_en desc limit 30`,
      [tarjetaId, TIPOS_DE_LA_EMPRESA],
    )).rows as FilaOperacion[];
    return { idep, fila, operaciones };
  });
  if (!leido) return null;
  const [saldo, saldos, movimientos] = await Promise.all([
    saldoEmpresa(cliente, leido.idep),
    saldosDeTarjetas(cliente, [leido.fila]),
    leido.fila.estado === "cancelada" ? Promise.resolve(null) : movimientosDe(cliente, leido.fila.id_efevoo),
  ]);
  return { tarjeta: tarjetaDe(leido.fila, saldos), saldoEmpresa: saldo, movimientos, operaciones: leido.operaciones.map(operacion) };
}

export type EntradaSaldo = { readonly tarjetaId: string; readonly tipo: "carga" | "retiro"; readonly centavos: number; readonly intento: string };

/** Lo que regresa el ciclo de E1, en la forma de la pantalla. */
function deEjecutada(op: OperacionEfevoo): OperacionTarjeta {
  if (!TIPOS_DE_LA_EMPRESA.includes(op.tipo)) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: op.id,
    tipo: op.tipo as TipoOperacionTarjeta,
    montoCentavos: op.montoCentavos,
    estado: op.estado,
    referencia: op.referencia,
    creadaEn: new Date(op.creadaEn).toISOString(),
    codigoEfevoo: op.codigoEfevoo,
    reintentoDe: op.reintentoDe,
    buscadaSinEncontrar: op.estado === "fallida" && op.codigoEfevoo === "no_aparecio",
  };
}

/**
 * Carga o retira saldo de una tarjeta desde (o hacia) el saldo de la empresa en Efevoo, con el ciclo de E1: se asienta
 * antes de llamar, la misma llave regresa la misma operación, y sin saldo queda fallida sin llamar al emisor.
 */
export async function moverSaldoTarjeta(ctx: ContextoDeTenant | null, entrada: EntradaSaldo, deps?: DependenciasOperacion): Promise<ResultadoOperacion> {
  const conEmpresa = exigirOperar(ctx);
  const r = await ejecutarOperacionEfevoo(conEmpresa, {
    tipo: entrada.tipo, llave: entrada.intento, companyId: conEmpresa.empresa.id, tarjetaId: entrada.tarjetaId, montoCentavos: entrada.centavos,
  }, llamadaEstandar, deps);
  return { operacion: deEjecutada(r), existente: !r.nueva };
}

export type EntradaBloqueo = { readonly tarjetaId: string; readonly accion: "bloqueo" | "desbloqueo"; readonly intento: string };

export async function cambiarBloqueoTarjeta(ctx: ContextoDeTenant | null, entrada: EntradaBloqueo, deps?: DependenciasOperacion): Promise<ResultadoOperacion> {
  const conEmpresa = exigirOperar(ctx);
  const r = await ejecutarOperacionEfevoo(conEmpresa, {
    tipo: entrada.accion, llave: entrada.intento, companyId: conEmpresa.empresa.id, tarjetaId: entrada.tarjetaId,
  }, llamadaEstandar, deps);
  return { operacion: deEjecutada(r), existente: !r.nueva };
}

export type ResultadoConciliacion =
  | { readonly resultado: "confirmada" | "no_aparecio" | "ambigua" | "ya_resuelta"; readonly operacion: OperacionTarjeta }
  | { readonly resultado: "espera"; readonly operacion: OperacionTarjeta; readonly minutos: number };

/** Busca una operación incierta en el emisor (E1): confirmada, no apareció (pasados 10 min), espera, ambigua o ya resuelta. */
export async function conciliarOperacionTarjeta(ctx: ContextoDeTenant | null, operacionId: string, deps?: DependenciasOperacion): Promise<ResultadoConciliacion> {
  const conEmpresa = exigirOperar(ctx);
  const c = await conciliarOperacionEfevoo(conEmpresa, conEmpresa.empresa.id, operacionId, deps);
  const operacion = deEjecutada(c.operacion);
  if (c.resultado === "espera") {
    const ahora = deps?.ahora?.() ?? new Date();
    return { resultado: "espera", operacion, minutos: Math.max(1, Math.ceil((new Date(c.reintentarDespuesDe).getTime() - ahora.getTime()) / 60_000)) };
  }
  return { resultado: c.resultado, operacion };
}

/** Una operación que no apareció en el emisor: la persona decide reintentar, con una referencia nueva ligada. */
export async function reintentarOperacionTarjeta(ctx: ContextoDeTenant | null, operacionId: string, intento: string, deps?: DependenciasOperacion): Promise<ResultadoOperacion> {
  const conEmpresa = exigirOperar(ctx);
  // Solo las que se buscaron y no aparecieron: un rechazo del emisor no se repite desde aquí.
  const anterior = await conContexto(baseCliente(conEmpresa), async (consulta) =>
    (await consulta.query("select estado, codigo_efevoo from efevoo_operaciones where id = $1 and company_id = app_empresa()", [operacionId])).rows[0] as
      { estado: string; codigo_efevoo: string | null } | undefined);
  if (!anterior) throw new ErrorDeDominio("operacion_ausente");
  if (anterior.estado !== "fallida" || anterior.codigo_efevoo !== "no_aparecio") throw new ErrorDeDominio("operacion_no_reintentable");
  const r = await reintentarOperacionEfevoo(conEmpresa, conEmpresa.empresa.id, operacionId, intento, llamadaEstandar, deps);
  return { operacion: deEjecutada(r), existente: !r.nueva };
}
