import { randomUUID } from "node:crypto";

import { aplicarSentencia, conContexto, type Consulta, type ContextoDeBase } from "../../nucleo/db";
import { baseCliente, basePlataforma, exigirEmpresa, exigirPersonal, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, actorDePersonal, auditar as auditarPorDefecto, type Actor, type Auditar } from "../bitacora/auditar";
import { centavosONulo, instante, registro, texto, textoONulo } from "../flujo/lectura";
import { clienteHttpEfevoo, type ClienteEfevoo } from "./cliente";
import { configEfevoo, type ConfigEfevoo } from "./config";
import { ErrorEfevoo } from "./errores";
import { registrarEfevoo } from "./registros";

/**
 * El ciclo de toda operación con Efevoo (reglas de dinero de efevoo/comun.md):
 *
 *   1. asentar  la operación en `pendiente`, con su evento, ANTES de llamar.
 *               La llave de intento del formulario hace idempotente el doble
 *               clic: la misma llave regresa la misma operación sin volver a
 *               llamar a Efevoo; con otros datos, `intento_con_otros_datos`.
 *   2. llamar   a Efevoo fuera de la transacción (no se tiene la base abierta
 *               mientras se espera la red).
 *   3. resolver `confirmada` o `fallida` (un rechazo, el falso éxito con id 0
 *               incluido); `incierta` ante timeout, 5xx o respuesta ilegible.
 *               Nunca se reintenta solo.
 *
 * Una incierta se concilia con conciliarOperacionEfevoo: se busca en Efevoo
 * por su referencia (o por lo que el método permita). Si aparece, queda
 * confirmada. Si no aparece y ya pasaron 10 minutos desde que se asentó,
 * queda fallida con «no_aparecio» y la persona puede reintentar con
 * reintentarOperacionEfevoo: una operación nueva, con referencia nueva y
 * ligada a la anterior. Antes de los 10 minutos se queda incierta y se dice
 * cuándo volver: Efevoo podría estar procesándola todavía.
 *
 * Quién puede qué lo decide la base (0033): carga, retiro, bloqueo y
 * desbloqueo, administración y liberación de la empresa; cancelación,
 * administración de la empresa o del personal; alta, depósito de prueba,
 * asignación y activación, solo administracion_plataforma.
 */

export type TipoOperacion =
  | "alta_cliente"
  | "deposito_prueba"
  | "asignacion"
  | "activacion"
  | "asignacion_cliente"
  | "carga"
  | "retiro"
  | "bloqueo"
  | "desbloqueo"
  | "cancelacion";
export type EstadoOperacion = "pendiente" | "confirmada" | "fallida" | "incierta";

/**
 * Los únicos rechazos que dicen que Efevoo NO hizo nada (medidos o propios de
 * Lever antes de llamar): la validación de campos, el falso éxito con id 0,
 * «Cuenta no encontrada» (115), «Tarjeta no encontrada» (122), «Hash
 * incorrecto» (101), «La tarjeta ya ha sido asignada» (163), «Empresa/Emisor no
 * encontrado» (112) y el 401. Cualquier otro código (901 de Parabilium, 1 «Ha
 * ocurrido un error», 100 «Error desconocido»…) no prueba que el dinero no se
 * movió: la operación queda incierta y se concilia antes de poder reintentarla.
 */
export const RECHAZOS_DEFINITIVOS: ReadonlySet<string> = new Set([
  "validacion", "id_cero", "115", "122", "101", "163", "112", "401",
  // Lever, antes de llamar a Efevoo.
  "saldo_insuficiente", "sin_tarjeta", "tarjeta_sin_titular", "sin_vinculo", "sin_monto",
]);

/**
 * Cuántos clientes sin vincular se leen (un getClient cada uno, ~600 ms en el sandbox) al buscar un alta por
 * correo: pocos dentro del alta misma, más en la conciliación que se pide a mano (PC2-1b).
 */
export const TOPE_ALTA_EN_EL_ACTO = 20;
export const TOPE_ALTA_CONCILIACION = 200;

/** Minutos desde que se asienta una operación antes de poder concluir que no apareció en Efevoo. */
export const MINUTOS_PARA_NO_APARECIO = 10;

export type EntradaOperacion = {
  tipo: TipoOperacion;
  /** La llave de intento del formulario (un UUID que el formulario genera al abrirse). */
  llave: string;
  companyId: string;
  /** Tarjeta de Lever (efevoo_tarjetas.id) en las operaciones sobre una tarjeta. */
  tarjetaId?: string | null;
  /** Asignación: el plástico del inventario de Efevoo, su terminación, el empleado y el nombre en la tarjeta. */
  inventario?: { idEfevoo: number; terminacion: string; employeeId: string | null; nombreTarjeta: string } | null;
  montoCentavos?: number | null;
  /** Cancelación: el motivo. */
  motivo?: string | null;
  /**
   * Depósito de prueba: el saldo de la empresa en Efevoo leído justo antes
   * (saldoDeEmpresaEfevoo). clientBalance no lleva referencia: la conciliación
   * busca un depósito del monto con ese saldo previo.
   */
  saldoPrevioCentavos?: number | null;
  reintentoDe?: string | null;
};

export type OperacionEfevoo = {
  id: string;
  companyId: string;
  tipo: TipoOperacion;
  estado: EstadoOperacion;
  ambiente: "sandbox" | "produccion";
  referencia: string;
  montoCentavos: number | null;
  tarjetaId: string | null;
  tarjetaInventario: number | null;
  terminacion: string | null;
  saldoPrevioCentavos: number | null;
  /** El id con que respondió Efevoo (idepCliente, id de la tarjeta o id de la respuesta de fundCard/unfundCard). */
  idEfevoo: string | null;
  /** El IDMovimiento de getTransactionsCard (o el id de balanceMovements) cuando se encontró al conciliar: otra serie. */
  idMovimientoEfevoo: string | null;
  /**
   * Carga: lo que suman las demás cargas abiertas (pendientes o inciertas) de la
   * empresa al momento de llamar. Se resta del saldo de Efevoo: una incierta cuenta como gastada.
   */
  otrasCargasAbiertasCentavos: number;
  codigoEfevoo: string | null;
  reintentoDe: string | null;
  creadaEn: string;
  resueltaEn: string | null;
  /** Lo que la llamada necesita de Efevoo: el idepCliente de la empresa y el id de Efevoo de la tarjeta. */
  idepCliente: number | null;
  tarjetaIdEfevoo: number | null;
};

/**
 * Lo que se le pide a Efevoo para esta operación. Devuelve el id que dio
 * Efevoo (idepCliente, id de la tarjeta o del movimiento), o nulo si el
 * método no da uno. Lanza ErrorEfevoo si Efevoo rechazó o no se sabe.
 */
export type LlamadaEfevoo = (op: OperacionEfevoo, efevoo: ClienteEfevoo) => Promise<string | null>;

export type DependenciasOperacion = {
  config?: ConfigEfevoo | null;
  efevoo?: ClienteEfevoo;
  auditar?: Auditar;
  ahora?: () => Date;
  /** Cuántos clientes lee la conciliación de un alta (TOPE_ALTA_CONCILIACION); las pruebas lo bajan. */
  topeAltaConciliacion?: number;
};

export type Ejecutada = OperacionEfevoo & {
  /** Falso si la llave de intento ya existía: se devolvió la operación de antes y Efevoo no se volvió a llamar. */
  nueva: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Quien = { base: ContextoDeBase; actor: Actor };

/** El personal (superficie sofipo) actúa con su rol de plataforma; un miembro, solo en su empresa. */
function quien(ctx: ContextoDeTenant | null | undefined, companyId: string): Quien {
  if (!UUID.test(companyId)) throw new ErrorDeDominio("entrada_invalida");
  if (ctx?.personal && ctx.superficie === "sofipo") {
    const personal = exigirPersonal(ctx, "plataforma.empresa.alta");
    return { base: basePlataforma(personal, companyId), actor: actorDePersonal(personal, companyId) };
  }
  const miembro = exigirEmpresa(ctx);
  if (miembro.empresa.id !== companyId) throw new ErrorDeDominio("sin_empresa");
  return { base: baseCliente(miembro), actor: actorDeCliente(miembro) };
}

function leerFila(valor: unknown): OperacionEfevoo & { employeeId: string | null; nombreTarjeta: string | null; motivo: string | null } {
  const f = registro(valor);
  const entero = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: texto(f.id),
    companyId: texto(f.company_id),
    tipo: texto(f.tipo) as TipoOperacion,
    estado: texto(f.estado) as EstadoOperacion,
    ambiente: texto(f.ambiente) as "sandbox" | "produccion",
    referencia: texto(f.referencia),
    montoCentavos: centavosONulo(f.monto_centavos),
    tarjetaId: textoONulo(f.tarjeta_id),
    tarjetaInventario: entero(f.tarjeta_inventario),
    terminacion: textoONulo(f.terminacion) ?? textoONulo(f.terminacion_tarjeta),
    saldoPrevioCentavos: centavosONulo(f.saldo_previo_centavos),
    idEfevoo: textoONulo(f.id_efevoo),
    idMovimientoEfevoo: textoONulo(f.id_movimiento_efevoo),
    otrasCargasAbiertasCentavos: 0,
    codigoEfevoo: textoONulo(f.codigo_efevoo),
    reintentoDe: textoONulo(f.reintento_de),
    creadaEn: instante(f.creada_en),
    resueltaEn: f.resuelta_en === null || f.resuelta_en === undefined ? null : instante(f.resuelta_en),
    idepCliente: entero(f.idep_cliente),
    tarjetaIdEfevoo: entero(f.tarjeta_id_efevoo),
    employeeId: textoONulo(f.employee_id),
    nombreTarjeta: textoONulo(f.nombre_tarjeta),
    motivo: textoONulo(f.motivo),
  };
}

/** Una operación de la empresa, por su id o por la llave de intento. SQL literal: solo placeholders $n. */
async function leerOperacion(consulta: Consulta, companyId: string, por: { id: string } | { llave: string }) {
  const r = await aplicarSentencia(
    consulta,
    `select o.id, o.company_id, o.tipo, o.estado, o.ambiente, o.referencia, o.monto_centavos::text as monto_centavos,
            o.tarjeta_id, o.tarjeta_inventario, o.terminacion, o.saldo_previo_centavos::text as saldo_previo_centavos,
            o.id_efevoo, o.id_movimiento_efevoo, o.codigo_efevoo, o.reintento_de, o.creada_en, o.resuelta_en,
            o.employee_id, o.nombre_tarjeta, o.motivo,
            v.idep_cliente, t.id_efevoo as tarjeta_id_efevoo, t.terminacion as terminacion_tarjeta
       from efevoo_operaciones o
       left join efevoo_clientes v on v.company_id = o.company_id
       left join efevoo_tarjetas t on t.id = o.tarjeta_id
      where o.company_id = $1
        and (($2::uuid is not null and o.id = $2::uuid) or ($2::uuid is null and o.llave_intento = $3::uuid))`,
    [companyId, "id" in por ? por.id : null, "llave" in por ? por.llave : null],
  );
  return r.rows[0] ? leerFila(r.rows[0]) : null;
}

/** Lo que sale del servicio: sin el empleado, el nombre en la tarjeta ni el motivo (solo los usa el reintento). */
function publica(op: ReturnType<typeof leerFila>): OperacionEfevoo {
  const resto: Partial<ReturnType<typeof leerFila>> = { ...op };
  delete resto.employeeId;
  delete resto.nombreTarjeta;
  delete resto.motivo;
  return resto as OperacionEfevoo;
}

function cambioDe(op: OperacionEfevoo, estado: EstadoOperacion, codigo: string | null) {
  return {
    tipo: op.tipo,
    monto_centavos: op.montoCentavos,
    referencia: op.referencia,
    terminacion: op.terminacion,
    estado,
    codigo_efevoo: codigo,
  };
}

/** Un código de Efevoo como la base lo acepta: minúsculas, dígitos y guion bajo. */
function codigoParaBase(codigo: string | null): string | null {
  if (codigo === null) return null;
  const limpio = codigo.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32);
  return limpio.length > 0 ? limpio : null;
}

/** 1. Asienta (o encuentra) la operación. Devuelve la fila y si es nueva. */
async function asentar(q: Quien, entrada: EntradaOperacion, ambiente: "sandbox" | "produccion", auditar: Auditar) {
  if (!UUID.test(entrada.llave)) throw new ErrorDeDominio("entrada_invalida");
  if (entrada.montoCentavos !== undefined && entrada.montoCentavos !== null && (!Number.isSafeInteger(entrada.montoCentavos) || entrada.montoCentavos < 1)) {
    throw new ErrorDeDominio("monto_invalido");
  }
  const leerPorLlave = (consulta: Consulta) =>
    leerOperacion(consulta, entrada.companyId, { llave: entrada.llave });
  try {
    return await conContexto(q.base, async (consulta) => {
      const id = randomUUID();
      const inv = entrada.inventario ?? null;
      const insertada = await aplicarSentencia(
        consulta,
        `insert into efevoo_operaciones (id, company_id, operator_id, ambiente, tipo, tarjeta_id, tarjeta_inventario, terminacion,
           employee_id, nombre_tarjeta, monto_centavos, motivo, llave_intento, reintento_de, actor_tipo, creada_por, saldo_previo_centavos)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         on conflict (company_id, llave_intento) do nothing
         returning id`,
        [
          id, entrada.companyId, q.actor.operadorId, ambiente, entrada.tipo, entrada.tarjetaId ?? null, inv?.idEfevoo ?? null,
          inv?.terminacion ?? null, inv?.employeeId ?? null, inv?.nombreTarjeta ?? null, entrada.montoCentavos ?? null,
          entrada.motivo ?? null, entrada.llave, entrada.reintentoDe ?? null, q.actor.actorTipo, q.actor.actorId,
          entrada.saldoPrevioCentavos ?? null,
        ],
      );
      if (insertada.rows.length === 0) {
        // La misma llave con los mismos datos: la base no insertó otra. Se regresa la de antes.
        const previa = await leerPorLlave(consulta);
        if (!previa) throw new ErrorDeDominio("base_no_disponible");
        mismaOperacion(previa, entrada);
        return { op: previa, nueva: false };
      }
      const op = await leerOperacion(consulta, entrada.companyId, { id });
      if (!op) throw new ErrorDeDominio("base_no_disponible");
      await auditar(consulta, q.actor, {
        accion: `efevoo_${entrada.tipo}`,
        identificador: id,
        motivo: entrada.motivo ?? null,
        cambio: cambioDe(op, "pendiente", null),
      });
      return { op, nueva: true };
    });
  } catch (error) {
    // Dos envíos a la vez con la misma llave: el segundo choca con el primero ya confirmado. Se lee el primero.
    if (error instanceof ErrorDeDominio && error.codigo === "intento_concurrente") {
      const previa = await conContexto(q.base, leerPorLlave);
      if (!previa) throw error;
      mismaOperacion(previa, entrada);
      return { op: previa, nueva: false };
    }
    throw error;
  }
}

function mismaOperacion(previa: ReturnType<typeof leerFila>, entrada: EntradaOperacion) {
  const inv = entrada.inventario ?? null;
  const igual = previa.tipo === entrada.tipo
    && previa.tarjetaId === (entrada.tarjetaId ?? null)
    && previa.tarjetaInventario === (inv?.idEfevoo ?? null)
    && previa.montoCentavos === (entrada.montoCentavos ?? null)
    && previa.employeeId === (inv?.employeeId ?? null)
    && previa.reintentoDe === (entrada.reintentoDe ?? null);
  if (!igual) throw new ErrorDeDominio("intento_con_otros_datos");
}

/** 3. Resuelve con su evento. */
async function resolver(
  q: Quien, op: OperacionEfevoo, estado: Exclude<EstadoOperacion, "pendiente">, idEfevoo: string | null, codigo: string | null, auditar: Auditar,
  idMovimiento: string | null = null, evento: { accion: "efevoo_cierre_manual"; motivo: string } | null = null,
) {
  const codigoBase = codigoParaBase(codigo);
  return conContexto(q.base, async (consulta) => {
    // El cierre manual no sabe qué pasó en Efevoo: su evento dice «resultado desconocido», no «fallida» (CM-1).
    const cambio = evento?.accion === "efevoo_cierre_manual"
      ? { tipo: op.tipo, monto_centavos: op.montoCentavos, referencia: op.referencia, terminacion: op.terminacion, resultado: "desconocido", codigo_efevoo: codigoBase }
      : cambioDe(op, estado, codigoBase);
    await auditar(consulta, q.actor, { accion: evento?.accion ?? `efevoo_${estado}`, identificador: op.id, motivo: evento?.motivo ?? null, cambio });
    await aplicarSentencia(consulta, "select efevoo_resolver_operacion($1, $2, $3, $4, $5)", [op.id, estado, idEfevoo, codigoBase, idMovimiento]);
    const fila = await leerOperacion(consulta, op.companyId, { id: op.id });
    if (!fila) throw new ErrorDeDominio("base_no_disponible");
    return publica(fila);
  });
}

function dependencias(deps: DependenciasOperacion | undefined) {
  const config = deps?.config === undefined ? configEfevoo() : deps.config;
  if (!config && !deps?.efevoo) throw new ErrorEfevoo("efevoo_no_configurado");
  const ambiente = config?.ambiente ?? "sandbox";
  return {
    ambiente,
    efevoo: deps?.efevoo ?? clienteHttpEfevoo(config!),
    auditar: deps?.auditar ?? auditarPorDefecto,
    ahora: deps?.ahora ?? (() => new Date()),
  };
}

/**
 * El ciclo completo. Regresa la operación ya resuelta (o la de antes, si la
 * llave de intento se repitió). Un rechazo de Efevoo NO lanza: regresa la
 * operación fallida con su código, para que la pantalla lo diga. Una incierta
 * tampoco: regresa en `incierta`.
 */
export async function ejecutarOperacionEfevoo(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaOperacion,
  llamada: LlamadaEfevoo,
  deps?: DependenciasOperacion,
): Promise<Ejecutada> {
  const q = quien(ctx, entrada.companyId);
  const d = dependencias(deps);
  const { op: asentada, nueva } = await asentar(q, entrada, d.ambiente, d.auditar);
  if (!nueva) return { ...publica(asentada), nueva: false };
  const op = publica(asentada);

  let idEfevoo: string | null = null;
  let resultado: { estado: "confirmada" | "fallida" | "incierta"; codigo: string | null };
  try {
    if (op.tipo === "carga") {
      // Con la operación ya asentada (y confirmada en la base), las demás cargas abiertas de la empresa se ven:
      // dos cargas a la vez en tarjetas distintas se restan una a la otra y, en el peor caso, las dos se rechazan.
      op.otrasCargasAbiertasCentavos = await conContexto(q.base, async (consulta) => {
        const r = await aplicarSentencia(consulta,
          `select coalesce(sum(monto_centavos), 0)::text as total from efevoo_operaciones
            where company_id = $1 and tipo = 'carga' and estado in ('pendiente', 'incierta') and id <> $2`, [op.companyId, op.id]);
        return Number(texto(registro(r.rows[0]).total));
      });
    }
    idEfevoo = await llamada(op, d.efevoo);
    resultado = { estado: "confirmada", codigo: null };
  } catch (error) {
    if (error instanceof ErrorEfevoo && error.codigo === "efevoo_no_autorizado") {
      resultado = { estado: "fallida", codigo: "401" };
    } else if (error instanceof ErrorEfevoo && error.codigo === "efevoo_rechazo") {
      const codigo = error.codigoEfevoo ?? "sin_codigo";
      resultado = RECHAZOS_DEFINITIVOS.has(codigo) ? { estado: "fallida", codigo } : { estado: "incierta", codigo };
    } else if (error instanceof ErrorEfevoo && error.codigo === "efevoo_incierto") {
      resultado = { estado: "incierta", codigo: error.codigoEfevoo ?? "incierto" };
    } else if (error instanceof ErrorDeDominio && error.codigo === "saldo_insuficiente") {
      // Lever validó el saldo antes de llamar: Efevoo no se tocó.
      resultado = { estado: "fallida", codigo: "saldo_insuficiente" };
    } else {
      // Cualquier otra cosa (un error de programa, la base caída a la mitad): no se sabe si Efevoo lo hizo.
      registrarEfevoo("error", "efevoo_llamada_sin_clasificar", { operacionId: op.id, companyId: op.companyId });
      resultado = { estado: "incierta", codigo: "sin_clasificar" };
    }
  }
  if (resultado.estado === "confirmada" && (op.tipo === "alta_cliente" || op.tipo === "asignacion") && !idEfevoo) {
    resultado = { estado: "incierta", codigo: "sin_id" };
  }
  // Un alta que Efevoo no confirmó (sin respuesta, o «Cliente previamente registrado», código 1) se busca de
  // inmediato por su correo: si el cliente con ese correo existe y no está vinculado, es esta empresa.
  if (op.tipo === "alta_cliente" && resultado.estado === "incierta") {
    try {
      const fila = await conContexto(q.base, (consulta) => leerOperacion(consulta, op.companyId, { id: op.id }));
      const hallada = fila ? await buscarEnEfevoo(fila, d.efevoo, op.companyId, q, d.ambiente, TOPE_ALTA_EN_EL_ACTO) : null;
      if (hallada?.aparecio && hallada.idEfevoo) {
        idEfevoo = hallada.idEfevoo;
        resultado = { estado: "confirmada", codigo: "conciliada" };
      }
    } catch (error) {
      if (!(error instanceof ErrorEfevoo)) throw error;
      // Efevoo no respondió al buscar: queda incierta, como estaba.
    }
  }
  const resuelta = await resolver(q, op, resultado.estado, resultado.estado === "confirmada" ? idEfevoo : null, resultado.codigo, d.auditar);
  return { ...resuelta, nueva: true };
}

export type Conciliacion =
  | { resultado: "confirmada"; operacion: OperacionEfevoo }
  | { resultado: "no_aparecio"; operacion: OperacionEfevoo }
  /** Más de un movimiento cuadra: no se adivina; queda incierta para revisarla a mano. */
  | { resultado: "ambigua"; operacion: OperacionEfevoo }
  /** Todavía no se puede concluir: vuelve a intentar después de esa hora (ISO). */
  | { resultado: "espera"; operacion: OperacionEfevoo; reintentarDespuesDe: string }
  /** Ya estaba resuelta: no hay nada que conciliar. */
  | { resultado: "ya_resuelta"; operacion: OperacionEfevoo };

/**
 * Busca en Efevoo una operación incierta (o pendiente que se quedó sin resolver):
 * - carga y retiro: getTransactionsCard, por la referencia y el monto;
 * - alta: getClientList, un cliente sin vincular con la razón social de la empresa;
 * - depósito de prueba: balanceMovements, un depósito del monto con el saldo previo anotado;
 * - asignación, activación, bloqueo, desbloqueo y cancelación: el estado de la tarjeta en getCardsList.
 * Un error de Efevoo al buscar se lanza y la operación no cambia.
 */
export async function conciliarOperacionEfevoo(
  ctx: ContextoDeTenant | null | undefined,
  companyId: string,
  operacionId: string,
  deps?: DependenciasOperacion,
): Promise<Conciliacion> {
  if (!UUID.test(operacionId)) throw new ErrorDeDominio("entrada_invalida");
  const q = quien(ctx, companyId);
  const d = dependencias(deps);
  const fila = await conContexto(q.base, (consulta) => leerOperacion(consulta, companyId, { id: operacionId }));
  if (!fila) throw new ErrorDeDominio("operacion_no_encontrada");
  const op = publica(fila);
  if (op.estado === "confirmada" || op.estado === "fallida") return { resultado: "ya_resuelta", operacion: op };

  const encontrada = await buscarEnEfevoo(fila, d.efevoo, companyId, q, d.ambiente, deps?.topeAltaConciliacion ?? TOPE_ALTA_CONCILIACION);
  if (encontrada.ambigua) return { resultado: "ambigua", operacion: op };
  if (encontrada.aparecio) {
    return { resultado: "confirmada", operacion: await resolver(q, op, "confirmada", encontrada.idEfevoo, "conciliada", d.auditar, encontrada.idMovimiento ?? null) };
  }
  const desde = new Date(new Date(op.creadaEn).getTime() + MINUTOS_PARA_NO_APARECIO * 60_000);
  if (d.ahora() < desde) return { resultado: "espera", operacion: op, reintentarDespuesDe: desde.toISOString() };
  return { resultado: "no_aparecio", operacion: await resolver(q, op, "fallida", null, "no_aparecio", d.auditar) };
}

async function buscarEnEfevoo(
  op: ReturnType<typeof leerFila>,
  efevoo: ClienteEfevoo,
  companyId: string,
  q: Quien,
  ambiente: "sandbox" | "produccion",
  topeAlta = TOPE_ALTA_CONCILIACION,
): Promise<{ aparecio: boolean; idEfevoo: string | null; idMovimiento?: string | null; ambigua?: boolean }> {
  const no = { aparecio: false, idEfevoo: null };
  const ambigua = { ...no, ambigua: true };
  switch (op.tipo) {
    case "carga":
    case "retiro": {
      if (!op.tarjetaIdEfevoo) return no;
      const correo = await efevoo.correoDeTarjeta(op.tarjetaIdEfevoo);
      if (!correo) return no;
      // Efevoo no deduplica referencias y el consecutivo de Lever se reinicia con la base del sandbox:
      // la misma referencia, el importe exacto, el tipo (Abono = carga, Cargo = retiro) y una hora no
      // anterior a la operación (con un margen de 2 minutos por relojes). Se guarda el IDMovimiento.
      // Un movimiento recién hecho puede llegar sin TipoMovimientoCargoAbono (el cliente lo saca del
      // concepto). Uno con la misma referencia que no se pueda leer completo (tipo, importe u hora) no
      // se descarta: da «ambigua», nunca «no apareció», para no reintentar algo que sí pasó.
      const desde = new Date(op.creadaEn).getTime() - 2 * 60_000;
      const tipo = op.tipo === "carga" ? "abono" : "cargo";
      const conReferencia = (await efevoo.movimientosDeTarjeta(op.tarjetaIdEfevoo, correo)).filter((x) => x.referencia === op.referencia);
      if (conReferencia.some((x) => x.tipo === null || x.centavos === null || horaDeMexico(x.fechaHora) === null)) return ambigua;
      const cuadran = conReferencia.filter((x) => x.centavos === op.montoCentavos && x.tipo === tipo && horaDeMexico(x.fechaHora)! >= desde);
      if (cuadran.length > 1) return ambigua;
      const m = cuadran[0];
      if (!m) return no;
      return /^[1-9][0-9]{0,17}$/.test(m.idMovimiento) ? { aparecio: true, idEfevoo: null, idMovimiento: m.idMovimiento } : ambigua;
    }
    case "deposito_prueba": {
      // clientBalance no lleva referencia: el depósito del monto, con el saldo previo anotado y una
      // hora no anterior a la operación. Sin saldo previo anotado, o con una hora ilegible, no se adivina.
      if (!op.idepCliente || op.montoCentavos === null) return no;
      if (op.saldoPrevioCentavos === null) return ambigua;
      const desde = new Date(op.creadaEn).getTime() - 2 * 60_000;
      const delMonto = (await efevoo.movimientosCliente(op.idepCliente, 1, 50))
        .filter((x) => x.operacion === "deposit" && x.centavos === op.montoCentavos && x.saldoPrevioCentavos === op.saldoPrevioCentavos);
      if (delMonto.some((x) => horaDeRegistro(x.registradoEn) === null)) return ambigua;
      const cuadran = delMonto.filter((x) => horaDeRegistro(x.registradoEn)! >= desde);
      if (cuadran.length > 1) return ambigua;
      return cuadran[0] ? { aparecio: true, idEfevoo: null, idMovimiento: String(cuadran[0].id) } : no;
    }
    case "alta_cliente": {
      // Por CORREO (PC2-1): en Efevoo el correo es único (un segundo alta con el mismo da «Cliente previamente
      // registrado»), la razón social no. getClientList no filtra por correo: se lee cada cliente sin vincular.
      // PC2-1b: del más nuevo al más viejo (el cliente recién creado tiene el idepCliente más alto), primero los
      // de la misma razón social, y se detiene en la primera coincidencia de correo (es único). Con un tope: si se
      // agota sin hallarlo, no se sabe → «ambigua», nunca «no apareció» (que llevaría a otro «previamente registrado»).
      const { correo, razon, vinculados } = await conContexto(q.base, async (consulta) => {
        const r = (await aplicarSentencia(consulta,
          `select coalesce((select v.razon_social from kyb_versiones v where v.company_id = c.id and v.estado = 'enviada' order by v.numero desc limit 1),
                           c.razon_social) as razon
             from companies c where c.id = $1`, [companyId])).rows[0];
        return {
          correo: await correoDeAltaEfevoo(consulta, companyId, ambiente),
          razon: r ? textoONulo(registro(r).razon)?.trim().toLowerCase() ?? null : null,
          vinculados: new Set((await aplicarSentencia(consulta, "select idep_cliente from efevoo_clientes", [])).rows.map((x) => Number(registro(x).idep_cliente))),
        };
      });
      if (!correo) return no;
      const sinVincular = (await efevoo.listarClientes()).filter((c) => !vinculados.has(c.idepCliente));
      const mismaRazon = (c: { nombre: string | null }) => razon !== null && c.nombre?.trim().toLowerCase() === razon;
      const enOrden = [...sinVincular].sort((a, b) => Number(mismaRazon(b)) - Number(mismaRazon(a)) || b.idepCliente - a.idepCliente);
      for (const c of enOrden.slice(0, topeAlta)) {
        if ((await efevoo.leerCliente(c.idepCliente)).correo === correo) return { aparecio: true, idEfevoo: String(c.idepCliente) };
      }
      return enOrden.length > topeAlta ? ambigua : no;
    }
    default: {
      const id = op.tipo === "asignacion" ? op.tarjetaInventario : op.tarjetaIdEfevoo;
      if (!id) return no;
      const tarjeta = await buscarTarjeta(efevoo, id);
      if (!tarjeta) return no;
      const listo = {
        asignacion: tarjeta.conTitular && tarjeta.idepCliente === op.idepCliente,
        activacion: tarjeta.estado === "active",
        asignacion_cliente: tarjeta.idepCliente === op.idepCliente,
        bloqueo: tarjeta.estado === "blocked",
        desbloqueo: tarjeta.estado === "active",
        cancelacion: tarjeta.estado === "cancelled",
      }[op.tipo as "asignacion" | "activacion" | "asignacion_cliente" | "bloqueo" | "desbloqueo" | "cancelacion"];
      return listo ? { aparecio: true, idEfevoo: op.tipo === "asignacion" ? String(id) : null } : no;
    }
  }
}

/**
 * El correo con que Lever da de alta a la empresa en Efevoo: en sandbox, uno de prueba derivado de su id
 * (`empresa-<12 del id>@lever.test`); en producción, el del expediente vigente. Lo usan el alta y su conciliación.
 */
export async function correoDeAltaEfevoo(consulta: Consulta, companyId: string, ambiente: "sandbox" | "produccion"): Promise<string | null> {
  if (ambiente === "sandbox") return `empresa-${companyId.replace(/-/g, "").slice(0, 12)}@lever.test`;
  const r = (await aplicarSentencia(consulta,
    "select correo from kyb_versiones where company_id = $1 and estado = 'enviada' order by numero desc limit 1", [companyId])).rows[0];
  const correo = r ? textoONulo(registro(r).correo) : null;
  return correo ? correo.trim().toLowerCase() : null;
}

/**
 * Cierre manual (PC2-4): una operación abierta sobre una tarjeta CANCELADA, que la conciliación ya no puede leer,
 * la cierra Administración de la plataforma a los 10 minutos, con motivo. El evento dice que el resultado en
 * Efevoo es desconocido (efevoo_cierre_manual). La operación queda fallida con «cierre_manual» y no se puede
 * reintentar: la base lo exige todo.
 */
export async function cerrarOperacionManualEfevoo(
  ctx: ContextoDeTenant | null | undefined,
  companyId: string,
  operacionId: string,
  motivo: string,
  deps?: DependenciasOperacion,
): Promise<OperacionEfevoo> {
  if (!UUID.test(operacionId)) throw new ErrorDeDominio("entrada_invalida");
  const q = quien(ctx, companyId);
  const d = dependencias(deps);
  const fila = await conContexto(q.base, (consulta) => leerOperacion(consulta, companyId, { id: operacionId }));
  if (!fila) throw new ErrorDeDominio("operacion_no_encontrada");
  return resolver(q, publica(fila), "fallida", null, "cierre_manual", d.auditar, null, { accion: "efevoo_cierre_manual", motivo });
}

/** FechaHora de Efevoo ("2026-11-11 22:37:22", hora de México, UTC−6 sin horario de verano) → milisegundos. */
export function horaDeMexico(texto: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-06:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** registerDate de balanceMovements ("4/1/2026 5:22:52 PM", hora de México) → milisegundos. */
export function horaDeRegistro(texto: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(texto.trim());
  if (!m) return null;
  const hora = (Number(m[4]) % 12) + (m[7] === "PM" ? 12 : 0);
  const dos = (n: number | string) => String(n).padStart(2, "0");
  const ms = Date.parse(`${m[3]}-${dos(m[1]!)}-${dos(m[2]!)}T${dos(hora)}:${m[5]}:${m[6]}-06:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** El saldo de la empresa en Efevoo, para anotarlo antes de un depósito de prueba. Nulo si no se puede leer. */
export async function saldoDeEmpresaEfevoo(efevoo: ClienteEfevoo, idepCliente: number): Promise<number | null> {
  const [empresa] = await efevoo.listarClientes([idepCliente]);
  return empresa?.idepCliente === idepCliente ? empresa.saldoCentavos : null;
}

async function buscarTarjeta(efevoo: ClienteEfevoo, id: number) {
  for (let pagina = 1; pagina <= 40; pagina++) {
    const lista = await efevoo.listarTarjetas({ estados: "todas", pagina, tamano: 50 });
    const t = lista.tarjetas.find((x) => x.id === id);
    if (t) return t;
    if (pagina >= lista.paginaFinal) break;
  }
  return null;
}

/**
 * Reintenta una operación que quedó fallida: una operación nueva, igual, con
 * referencia nueva y ligada a la anterior (la base exige que la anterior esté
 * fallida y sea igual). La llave es la del formulario del reintento.
 */
export async function reintentarOperacionEfevoo(
  ctx: ContextoDeTenant | null | undefined,
  companyId: string,
  operacionId: string,
  llave: string,
  llamada: LlamadaEfevoo,
  deps?: DependenciasOperacion,
): Promise<Ejecutada> {
  if (!UUID.test(operacionId)) throw new ErrorDeDominio("entrada_invalida");
  const q = quien(ctx, companyId);
  const anterior = await conContexto(q.base, (consulta) => leerOperacion(consulta, companyId, { id: operacionId }));
  if (!anterior) throw new ErrorDeDominio("operacion_no_encontrada");
  if (anterior.estado !== "fallida") throw new ErrorDeDominio("reintento_no_valido");
  return ejecutarOperacionEfevoo(ctx, {
    tipo: anterior.tipo,
    llave,
    companyId,
    tarjetaId: anterior.tarjetaId,
    inventario: anterior.tarjetaInventario === null ? null : {
      idEfevoo: anterior.tarjetaInventario,
      terminacion: anterior.terminacion ?? "",
      employeeId: anterior.employeeId,
      nombreTarjeta: anterior.nombreTarjeta ?? "",
    },
    montoCentavos: anterior.montoCentavos,
    motivo: anterior.motivo,
    reintentoDe: anterior.id,
  }, llamada, deps);
}

// Llamadas de cada tipo que no piden datos personales ---------------------------------

const OBSERVACION = "Lever";

async function correoDe(efevoo: ClienteEfevoo, op: OperacionEfevoo): Promise<{ id: number; correo: string }> {
  if (!op.tarjetaIdEfevoo) throw new ErrorEfevoo("efevoo_rechazo", "sin_tarjeta");
  const correo = await efevoo.correoDeTarjeta(op.tarjetaIdEfevoo);
  if (!correo) throw new ErrorEfevoo("efevoo_rechazo", "tarjeta_sin_titular");
  return { id: op.tarjetaIdEfevoo, correo };
}

/**
 * Carga, retiro, bloqueo, desbloqueo, cancelación, activación, asignación a
 * la empresa y el depósito de prueba. Antes de mover dinero, Lever revisa el
 * saldo (el sandbox no lo hace): para cargar, el de la empresa en Efevoo;
 * para retirar, el de la tarjeta. Sin saldo, la operación queda fallida con
 * «saldo_insuficiente» y Efevoo no se llama.
 */
export const llamadaEstandar: LlamadaEfevoo = async (op, efevoo) => {
  switch (op.tipo) {
    case "carga": {
      if (!op.idepCliente || op.montoCentavos === null) throw new ErrorEfevoo("efevoo_rechazo", "sin_vinculo");
      const [empresa] = await efevoo.listarClientes([op.idepCliente]);
      if (!empresa || empresa.saldoCentavos === null || empresa.saldoCentavos - op.otrasCargasAbiertasCentavos < op.montoCentavos) {
        throw new ErrorDeDominio("saldo_insuficiente");
      }
      const { id, correo } = await correoDe(efevoo, op);
      return String((await efevoo.cargarTarjeta(id, correo, op.montoCentavos, op.referencia, OBSERVACION)).id);
    }
    case "retiro": {
      if (op.montoCentavos === null) throw new ErrorEfevoo("efevoo_rechazo", "sin_monto");
      const { id, correo } = await correoDe(efevoo, op);
      const tarjeta = await buscarTarjeta(efevoo, id);
      if (!tarjeta || tarjeta.saldoCentavos === null || tarjeta.saldoCentavos < op.montoCentavos) throw new ErrorDeDominio("saldo_insuficiente");
      return String((await efevoo.retirarTarjeta(id, correo, op.montoCentavos, op.referencia, OBSERVACION)).id);
    }
    case "bloqueo":
    case "desbloqueo": {
      const { id, correo } = await correoDe(efevoo, op);
      await efevoo.bloquearTarjeta(id, correo, op.tipo === "bloqueo" ? "block" : "unblock");
      return null;
    }
    case "cancelacion": {
      const { id, correo } = await correoDe(efevoo, op);
      await efevoo.cancelarTarjeta(id, correo);
      return null;
    }
    case "activacion": {
      const { id, correo } = await correoDe(efevoo, op);
      await efevoo.activarTarjeta(id, correo);
      return null;
    }
    case "asignacion_cliente": {
      if (!op.idepCliente || !op.tarjetaIdEfevoo) throw new ErrorEfevoo("efevoo_rechazo", "sin_vinculo");
      const [r] = await efevoo.asignarTarjetasACliente(op.idepCliente, [op.tarjetaIdEfevoo]);
      if (!r?.asignada) throw new ErrorEfevoo("efevoo_rechazo", "no_asignada");
      return null;
    }
    case "deposito_prueba": {
      if (!op.idepCliente || op.montoCentavos === null) throw new ErrorEfevoo("efevoo_rechazo", "sin_vinculo");
      await efevoo.moverSaldoCliente(op.idepCliente, op.montoCentavos, "deposit");
      return null;
    }
    default:
      // Alta y asignación piden datos que Lever no guarda: su llamada la arma quien los recibe.
      throw new ErrorDeDominio("entrada_invalida");
  }
};
