import { createHash, randomUUID } from "node:crypto";

import { digitoClabe } from "../../dominio/clabe";
import { conciliar, referenciaABuscar, type CargoConReferencia, type Decision } from "../../dominio/cobranza/conciliacion";
import { normalizarReferencia } from "../../dominio/cobranza/referencia";
import type { EmpresaDelContexto } from "../../nucleo/contexto";
import { aplicarSentencia, bloquearEmpresa, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Actor, Auditar } from "../bitacora/auditar";
import { centavos, registro, texto } from "../flujo/lectura";
import { autorDe } from "./comun";
import { fechaDe } from "./repositorio";

/**
 * De dónde llega un abono: el aviso del proveedor SPEI (Fintoc, a la CLABE
 * propia del cliente), un renglón confirmado del estado de cuenta, el adaptador
 * demo (solo en empresas de demostración) o el modo manual (una persona con su
 * comprobante). Cada adaptador solo traduce y verifica lo suyo; la conciliación
 * es una sola y pasa por `recibirAbono`.
 */

export type AbonoRecibido = {
  /** Del proveedor: su id de notificación, o clave de rastreo + fecha + monto. */
  idExterno: string;
  montoCentavos: number;
  recibidoEl: string;
  claveRastreo: string | null;
  referencia: string | null;
  clabeOrdenante: string | null;
  nombreOrdenante: string | null;
  /** El cliente dueño de la CLABE propia a la que llegó (proveedor SPEI), o nulo. */
  clienteDeLaCuenta: string | null;
};

export type FuenteAutomatica = "demo" | "fintoc" | "estado_cuenta";

export interface FuenteDeAbonos {
  readonly fuente: FuenteAutomatica;
  /** Si la empresa puede recibir abonos de esta fuente. */
  disponiblePara(empresa: Pick<EmpresaDelContexto, "demostracion">): boolean;
}

export type ResultadoAbono = {
  pagoId: string;
  /** El mismo aviso ya había llegado: no se creó nada. */
  repetido: boolean;
  decision: Decision | null;
};

export type FuenteDePago = FuenteAutomatica | "manual";

/**
 * El cliente de un abono para el freno de duplicados: el único que nombran todas sus identificaciones, o nulo si ninguna
 * lo nombra o si nombran a más de uno (r63e-N1). Nulo es el lado conservador: cualquier parecido frena.
 */
export function clienteSinDuda(identificaciones: readonly (string | null | undefined)[]): string | null {
  const clientes = new Set(identificaciones.filter((c): c is string => typeof c === "string" && c !== ""));
  return clientes.size === 1 ? [...clientes][0]! : null;
}

export type PagoParecido = { pagoId: string; fuente: FuenteDePago; recibidoEl: string; montoCentavos: number; cliente: string | null };

/**
 * r63b-N1: el mismo depósito puede llegar por dos fuentes (el aviso de Fintoc y el estado de cuenta, o un pago a mano
 * y el estado de cuenta) sin una clave de rastreo que los empate. Antes de aplicar un abono se busca un pago vigente de
 * OTRA fuente con el mismo monto y fecha a ±1 día cuya referencia coincida. Si existe, el abono queda en «Por
 * conciliar» como posible duplicado y una persona lo aplica o lo descarta.
 *
 * La referencia de un pago es la que trajo (si es una referencia válida de Lever) o, si no trajo, la del cargo al que se
 * aplicó (así un pago a mano tiene la de su cargo). **Criterio conservador:** si el abono o el pago registrado no tienen
 * referencia, basta monto y fecha; ante la duda va a «Por conciliar», nunca se aplica doble. Dos referencias distintas
 * son dos pagos distintos. Corre dentro de la transacción de quien llama, con la empresa bloqueada
 * (`bloquearEmpresa`): dos fuentes a la vez se forman y la segunda ve a la primera.
 *
 * Si el abono sabe sin duda de qué cliente es, un pago parecido de OTRO cliente no cuenta: son dos depósitos de dos
 * clientes (r63d-N1). «Sin duda» quiere decir que todo lo que lo identifica dice el mismo cliente: la CLABE propia, los
 * clientes que antes pagaron desde la CLABE ordenante, el cargo de la referencia y el cargo o el cliente que eligió una
 * persona (`clienteSinDuda`). Con cualquier desacuerdo (por ejemplo, la referencia de D desde la CLABE de U, r63e-N1) se
 * trata como sin cliente y cualquier parecido frena. Un parecido sin cliente, o del mismo, siempre cuenta.
 *
 * Recibe varios abonos a la vez (la propuesta de un estado de cuenta) y devuelve, por clave, el pago más cercano.
 */
export async function pagosParecidosDeOtraFuente(
  consulta: Consulta,
  empresaId: string,
  fuente: FuenteDePago,
  abonos: readonly { clave: string; montoCentavos: number; recibidoEl: string; referencia: string | null; clienteId?: string | null }[],
): Promise<Map<string, PagoParecido>> {
  if (abonos.length === 0) return new Map();
  const r = await aplicarSentencia(
    consulta,
    `select a.clave, p.id, p.fuente, p.recibido_el, p.monto_centavos::text as monto, k.nombre as cliente
       from unnest($3::text[], $4::bigint[], $5::date[], $6::text[], $7::uuid[]) as a (clave, monto, recibido_el, referencia, cliente)
       cross join lateral (
         select p.id, p.fuente, p.recibido_el, p.monto_centavos, p.customer_id
           from collection_payments p
           left join lateral (
             select c.referencia from collection_applications ap
               join collection_charges c on c.id = ap.charge_id and c.company_id = ap.company_id
              where ap.company_id = p.company_id and ap.payment_id = p.id and ap.regla <> 'reversion'
              order by ap.aplicado_en, ap.id limit 1
           ) aplicada on true
          where p.company_id = $1 and p.fuente <> $2 and p.estado not in ('anulado', 'devuelto')
            and p.monto_centavos = a.monto
            and p.recibido_el between a.recibido_el - 1 and a.recibido_el + 1
            and (a.cliente is null or p.customer_id is null or p.customer_id = a.cliente)
            and (a.referencia is null
                 or coalesce(case when p.referencia ~ '^[1-9][0-9]{6}$' then p.referencia end, aplicada.referencia) is null
                 or coalesce(case when p.referencia ~ '^[1-9][0-9]{6}$' then p.referencia end, aplicada.referencia) = a.referencia)
          order by abs(p.recibido_el - a.recibido_el), p.registrado_en, p.id
          limit 1
       ) p
       left join collection_customers k on k.id = p.customer_id and k.company_id = $1`,
    [empresaId, fuente, abonos.map((a) => a.clave), abonos.map((a) => a.montoCentavos), abonos.map((a) => a.recibidoEl),
      abonos.map((a) => normalizarReferencia(a.referencia)), abonos.map((a) => a.clienteId ?? null)],
  );
  return new Map(r.rows.map(registro).map((f) => [texto(f.clave), {
    pagoId: texto(f.id),
    fuente: texto(f.fuente) as FuenteDePago,
    recibidoEl: fechaDe(f.recibido_el),
    montoCentavos: centavos(f.monto),
    cliente: f.cliente === null || f.cliente === undefined ? null : texto(f.cliente),
  }]));
}

/**
 * El único camino de un abono automático: lo guarda (o reconoce el repetido),
 * concilia con las reglas puras contra los cargos de la empresa bloqueada,
 * aplica lo que corresponde y deja todo en la bitácora. Va dentro de la
 * transacción de quien llama, con la empresa en el contexto.
 */
export async function recibirAbono(
  consulta: Consulta,
  actor: Actor,
  auditar: Auditar,
  fuente: FuenteAutomatica,
  abono: AbonoRecibido,
): Promise<ResultadoAbono> {
  const empresaId = actor.companyId;
  if (!empresaId) throw new ErrorDeDominio("sin_empresa");
  await bloquearEmpresa(consulta, empresaId);
  const previo = await aplicarSentencia(
    consulta,
    "select id from collection_payments where company_id = $1 and fuente = $2 and id_externo = $3",
    [empresaId, fuente, abono.idExterno],
  );
  if (previo.rows[0]) return { pagoId: texto(registro(previo.rows[0]).id), repetido: true, decision: null };

  const referencia = referenciaABuscar(abono);
  let cargoDeLaReferencia: CargoConReferencia | null = null;
  if (referencia) {
    const r = await aplicarSentencia(
      consulta,
      `select id, customer_id, estado, (coalesce(monto_centavos, 0) - pagado_centavos)::text as saldo
         from collection_charges where company_id = $1 and referencia = $2 for update`,
      [empresaId, referencia],
    );
    const fila = r.rows[0] ? registro(r.rows[0]) : null;
    if (fila) {
      cargoDeLaReferencia = {
        id: texto(fila.id),
        clienteId: texto(fila.customer_id),
        estado: texto(fila.estado) as CargoConReferencia["estado"],
        saldoCentavos: centavos(fila.saldo),
      };
    }
  }
  const rastreoYaRegistrado = abono.claveRastreo !== null && (await aplicarSentencia(
    consulta,
    "select 1 from collection_payments where company_id = $1 and upper(clave_rastreo) = upper($2) and estado not in ('anulado', 'devuelto') limit 1",
    [empresaId, abono.claveRastreo],
  )).rows.length > 0;
  const clienteDeLaCuenta = abono.clienteDeLaCuenta;
  // Quién ha pagado antes desde esa CLABE: identifica al cliente sin referencia y, con referencia, marca el pago que
  // llega desde la cuenta de otro cliente (r63-N4).
  let clientesDeLaClabe: string[] = [];
  if (abono.clabeOrdenante) {
    const r = await aplicarSentencia(
      consulta,
      `select distinct customer_id from collection_payments
        where company_id = $1 and clabe_ordenante = $2 and customer_id is not null and estado not in ('anulado', 'devuelto')`,
      [empresaId, abono.clabeOrdenante],
    );
    clientesDeLaClabe = r.rows.map(registro).map((f) => texto(f.customer_id));
  }
  const clienteConocido = clienteDeLaCuenta ?? (clientesDeLaClabe.length === 1 ? clientesDeLaClabe[0]! : null);
  // El cliente al que va el dinero, solo si todo lo que identifica al abono coincide (r63e-N1).
  const clienteDelAbono = clienteSinDuda([clienteDeLaCuenta, ...clientesDeLaClabe, cargoDeLaReferencia?.clienteId ?? null]);
  const parecido = rastreoYaRegistrado
    ? null
    : (await pagosParecidosDeOtraFuente(consulta, empresaId, fuente, [
        { clave: "abono", montoCentavos: abono.montoCentavos, recibidoEl: abono.recibidoEl, referencia, clienteId: clienteDelAbono },
      ])).get("abono") ?? null;
  let cargosAbiertosDelCliente: { id: string; saldoCentavos: number; vencimiento: string }[] = [];
  if (!cargoDeLaReferencia && clienteConocido) {
    const c = await aplicarSentencia(
      consulta,
      `select id, (monto_centavos - pagado_centavos)::text as saldo, vencimiento from collection_charges
        where company_id = $1 and customer_id = $2 and estado = 'emitido' order by vencimiento, id for update`,
      [empresaId, clienteConocido],
    );
    cargosAbiertosDelCliente = c.rows.map(registro).map((f) => ({ id: texto(f.id), saldoCentavos: centavos(f.saldo), vencimiento: fechaDe(f.vencimiento) }));
  }
  const decision = conciliar(abono, { rastreoYaRegistrado, parecidoDeOtraFuente: parecido !== null, clienteDeLaCuenta, cargoDeLaReferencia, clientesDeLaClabe, cargosAbiertosDelCliente });
  const pagoId = randomUUID();
  await aplicarSentencia(
    consulta,
    `insert into collection_payments
       (id, company_id, fuente, id_externo, monto_centavos, recibido_el, clave_rastreo, referencia, clabe_ordenante, nombre_ordenante,
        customer_id, posible_duplicado, de_otro_cliente, parecido_a, registrado_por)
     values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [pagoId, empresaId, fuente, abono.idExterno, abono.montoCentavos, abono.recibidoEl, abono.claveRastreo, abono.referencia,
      abono.clabeOrdenante, abono.nombreOrdenante, decision.clienteId, decision.posibleDuplicado, decision.deOtroCliente,
      decision.motivo === "parecido_de_otra_fuente" ? parecido!.pagoId : null, autorDe(actor)],
  );
  await auditar(consulta, actor, {
    accion: "registrar_pago_cobranza",
    identificador: pagoId,
    cambio: {
      fuente, monto_centavos: abono.montoCentavos, recibido_el: abono.recibidoEl, regla: decision.motivo, posible_duplicado: decision.posibleDuplicado,
      de_otro_cliente: decision.deOtroCliente, con_comprobante: false,
      parecido_a: decision.motivo === "parecido_de_otra_fuente" ? parecido!.pagoId : null,
    },
  });
  if (decision.aplicacion) {
    await aplicar(consulta, actor, auditar, empresaId, pagoId, decision.aplicacion.cargoId, decision.aplicacion.montoCentavos, decision.aplicacion.regla, abono.recibidoEl);
  }
  await alRecibirAbonoRegulado(consulta, fuente, pagoId);
  return { pagoId, repetido: false, decision };
}

/**
 * Aplica `monto` de un pago a un cargo emitido: la aplicación, lo pagado del
 * cargo (y su estado) y lo aplicado del pago, cada uno con su evento. La base
 * verifica al confirmar que las sumas cuadran.
 */
export async function aplicar(
  consulta: Consulta,
  actor: Actor,
  auditar: Auditar,
  empresaId: string,
  pagoId: string,
  cargoId: string,
  monto: number,
  regla: "referencia" | "clabe_y_monto" | "manual",
  recibidoEl: string,
): Promise<void> {
  const aplicacionId = randomUUID();
  await aplicarSentencia(
    consulta,
    `insert into collection_applications (id, company_id, payment_id, charge_id, monto_centavos, regla, aplicado_por)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [aplicacionId, empresaId, pagoId, cargoId, monto, regla, autorDe(actor)],
  );
  await auditar(consulta, actor, { accion: "aplicacion_cobranza", identificador: aplicacionId, cambio: { monto_centavos: monto, regla } });
  const cargo = await aplicarSentencia(
    consulta,
    `update collection_charges
        set pagado_centavos = pagado_centavos + $3,
            estado = case when pagado_centavos + $3 >= monto_centavos then 'pagado' else 'emitido' end,
            pagado_el = case when pagado_centavos + $3 >= monto_centavos then $4::date end
      where company_id = $1 and id = $2 and estado = 'emitido' and pagado_centavos + $3 <= monto_centavos
      returning estado, pagado_centavos::text as pagado`,
    [empresaId, cargoId, monto, recibidoEl],
  );
  const fila = cargo.rows[0] ? registro(cargo.rows[0]) : null;
  if (!fila) throw new ErrorDeDominio("cargo_ya_resuelto");
  await auditar(consulta, actor, { accion: "abono_cargo", identificador: cargoId, cambio: { pagado_centavos: centavos(fila.pagado), estado: texto(fila.estado) } });
  const pago = await aplicarSentencia(
    consulta,
    `update collection_payments
        set aplicado_centavos = aplicado_centavos + $3,
            estado = case when aplicado_centavos + $3 = monto_centavos then 'aplicado' else 'abierto' end
      where company_id = $1 and id = $2 and estado = 'abierto' and aplicado_centavos + $3 <= monto_centavos
      returning estado, aplicado_centavos::text as aplicado`,
    [empresaId, pagoId, monto],
  );
  const filaPago = pago.rows[0] ? registro(pago.rows[0]) : null;
  if (!filaPago) throw new ErrorDeDominio("pago_ya_aplicado");
  await auditar(consulta, actor, { accion: "saldo_pago_cobranza", identificador: pagoId, cambio: { aplicado_centavos: centavos(filaPago.aplicado), estado: texto(filaPago.estado) } });
}

/**
 * Punto de enganche de PLD. Hoy el dinero de la cobranza llega a cuentas de la
 * empresa fuera de la SOFIPO: su banco (manual y estado de cuenta) o su cuenta
 * en Fintoc, donde Fintoc es quien recibe y hace su propio PLD. Ninguna es una
 * operación de la SOFIPO y no se reporta. Cuando la fuente sea la cuenta de la
 * empresa en la SOFIPO, cada abono es operación relevante y aquí se llama
 * `pld_registrar_*` (PR #61, migración 0030).
 */
const alRecibirAbonoRegulado: (consulta: Consulta, fuente: FuenteDePago, pagoId: string) => Promise<void> = async () => {};

// Adaptador demo ------------------------------------------------------------------------

export const fuenteDemo: FuenteDeAbonos = {
  fuente: "demo",
  disponiblePara: (empresa) => empresa.demostracion,
};

export type VarianteDemo = "exacto" | "parcial" | "de_mas" | "duplicado" | "repetir_aviso" | "sin_referencia";

/** Una CLABE ordenante ficticia y fija por cliente, con su dígito verificador (banco 999: no existe). */
export function clabeOrdenanteDemo(clienteId: string): string {
  const digitos = BigInt(`0x${createHash("sha256").update(clienteId).digest("hex").slice(0, 15)}`).toString().padStart(14, "0").slice(-14);
  const diecisiete = `999${digitos}`;
  return `${diecisiete}${digitoClabe(diecisiete)}`;
}

/**
 * El abono que «llega» en una empresa de demostración para el cargo elegido:
 * exacto, parcial (la mitad), de más (+10 %), duplicado (otra transferencia por
 * lo mismo, con la referencia de un cargo ya pagado), el mismo aviso repetido
 * (misma clave de rastreo: no debe crear nada) o sin referencia (se identifica
 * por la CLABE del cliente y el monto).
 */
export function abonoDemo(
  cargo: { id: string; clienteId: string; referencia: string; montoCentavos: number; saldoCentavos: number },
  variante: VarianteDemo,
  hoy: string,
  ultimo: { idExterno: string; claveRastreo: string | null } | null,
): AbonoRecibido {
  if (variante === "repetir_aviso") {
    if (!ultimo) throw new ErrorDeDominio("sin_abono_previo");
    return { ...abonoBase(cargo, cargo.saldoCentavos || cargo.montoCentavos, hoy), idExterno: ultimo.idExterno, claveRastreo: ultimo.claveRastreo };
  }
  const monto = variante === "parcial"
    ? Math.max(1, Math.floor(cargo.saldoCentavos / 2))
    : variante === "de_mas"
      ? cargo.saldoCentavos + Math.max(100, Math.round(cargo.saldoCentavos / 10))
      : variante === "duplicado"
        ? cargo.montoCentavos
        : cargo.saldoCentavos;
  const abono = abonoBase(cargo, monto, hoy);
  return variante === "sin_referencia" ? { ...abono, referencia: null } : abono;
}

function abonoBase(cargo: { clienteId: string; referencia: string }, monto: number, hoy: string): AbonoRecibido {
  const rastreo = `DEMO${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
  return {
    idExterno: `demo:${rastreo}`,
    montoCentavos: monto,
    recibidoEl: hoy,
    claveRastreo: rastreo,
    referencia: cargo.referencia,
    clabeOrdenante: clabeOrdenanteDemo(cargo.clienteId),
    nombreOrdenante: "Ordenante de demostración",
    clienteDeLaCuenta: null,
  };
}
