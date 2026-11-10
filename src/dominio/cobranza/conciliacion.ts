import { normalizarReferencia } from "./referencia";

/**
 * Reglas de conciliación de un abono. Puras: el servicio lee de la base lo que
 * hace falta (el cargo de la referencia, quién ha pagado desde esa CLABE y los
 * cargos abiertos de ese cliente) y aplica lo que esto decide.
 *
 * Nunca se adivina. Aplicar mal es peor que no aplicar: lo ambiguo queda
 * abierto en la bandeja «Por conciliar» para que una persona decida.
 *
 * 1. Referencia de un cargo emitido → se aplica hasta su saldo; lo que sobra es
 *    saldo a favor del cliente (pago de más).
 * 2. Referencia de un cargo ya pagado → no se aplica: es otra transferencia por
 *    lo mismo (posible pago duplicado) y todo queda como saldo a favor.
 * 3. Sin referencia útil, el cliente se sabe por la CLABE propia a la que
 *    llegó el abono (la que el proveedor SPEI le dio) o porque la CLABE
 *    ordenante ya pagó antes a un solo cliente, y el monto es exactamente el
 *    saldo de uno solo de sus cargos abiertos → se aplica a ese cargo.
 * 4. Una referencia de otro cliente en la CLABE propia de un cliente → no se
 *    aplica: queda abierto con el dueño de la CLABE para que alguien decida.
 * 5. Cualquier otro caso → abierto, con el cliente si se supo.
 *
 * 0. Antes que todo: si la misma clave de rastreo ya está en otro pago (por
 *    ejemplo, registrado a mano y luego avisado por el proveedor), no se aplica
 *    y se marca como posible duplicado.
 *
 * Un monto menor al saldo se aplica completo y el cargo queda con pago parcial.
 * El aviso repetido del mismo abono no llega aquí: lo detiene la llave
 * (fuente, id_externo) de la base.
 */

export type AbonoAConciliar = {
  montoCentavos: number;
  referencia: string | null;
  clabeOrdenante: string | null;
};

export type CargoConReferencia = {
  id: string;
  clienteId: string;
  estado: "por_emitir" | "emitido" | "pagado" | "cancelado" | "omitido";
  saldoCentavos: number;
};

export type CargoAbierto = { id: string; saldoCentavos: number; vencimiento: string };

export type Regla = "referencia" | "clabe_y_monto";

export type Decision = {
  clienteId: string | null;
  aplicacion: { cargoId: string; montoCentavos: number; regla: Regla } | null;
  posibleDuplicado: boolean;
  /** Por qué: para la bitácora y para el aviso de la página. */
  motivo:
    | "referencia"
    | "referencia_pagada"
    | "referencia_sin_cargo_abierto"
    | "referencia_de_otro_cliente"
    | "rastreo_ya_registrado"
    | "cuenta_y_monto"
    | "clabe_y_monto"
    | "cliente_sin_coincidencia"
    | "sin_identificar";
};

export type DatosDeConciliacion = {
  /** La clave de rastreo del abono ya está en otro pago vigente de la empresa. */
  rastreoYaRegistrado: boolean;
  /** El dueño de la CLABE propia a la que llegó el abono (proveedor SPEI), o nulo. */
  clienteDeLaCuenta: string | null;
  /** El cargo cuya referencia trae el abono, en cualquier estado, o nulo. */
  cargoDeLaReferencia: CargoConReferencia | null;
  /** Los clientes que antes pagaron desde la CLABE ordenante (sin repetir). */
  clientesDeLaClabe: readonly string[];
  /** Los cargos emitidos con saldo del cliente que se supo (por la cuenta o por la CLABE ordenante). */
  cargosAbiertosDelCliente: readonly CargoAbierto[];
};

/** Lo que el servicio tiene que buscar para conciliar este abono. */
export function referenciaABuscar(abono: AbonoAConciliar): string | null {
  return normalizarReferencia(abono.referencia);
}

export function conciliar(abono: AbonoAConciliar, datos: DatosDeConciliacion): Decision {
  if (!Number.isSafeInteger(abono.montoCentavos) || abono.montoCentavos <= 0) throw new Error("monto_invalido");
  const cuenta = datos.clienteDeLaCuenta;
  const cargo = datos.cargoDeLaReferencia;
  if (datos.rastreoYaRegistrado) {
    return { clienteId: cuenta ?? cargo?.clienteId ?? null, aplicacion: null, posibleDuplicado: true, motivo: "rastreo_ya_registrado" };
  }
  if (cargo && cuenta && cargo.clienteId !== cuenta) {
    return { clienteId: cuenta, aplicacion: null, posibleDuplicado: false, motivo: "referencia_de_otro_cliente" };
  }
  if (cargo) {
    if (cargo.estado === "emitido" && cargo.saldoCentavos > 0) {
      return {
        clienteId: cargo.clienteId,
        aplicacion: { cargoId: cargo.id, montoCentavos: Math.min(abono.montoCentavos, cargo.saldoCentavos), regla: "referencia" },
        posibleDuplicado: false,
        motivo: "referencia",
      };
    }
    if (cargo.estado === "pagado") {
      return { clienteId: cargo.clienteId, aplicacion: null, posibleDuplicado: true, motivo: "referencia_pagada" };
    }
    // Cancelado, omitido o sin monto: el cliente se sabe, el cargo no se toca.
    return { clienteId: cargo.clienteId, aplicacion: null, posibleDuplicado: false, motivo: "referencia_sin_cargo_abierto" };
  }
  const clientes = [...new Set(datos.clientesDeLaClabe)];
  const clienteId = cuenta ?? (clientes.length === 1 ? clientes[0]! : null);
  if (!clienteId) return { clienteId: null, aplicacion: null, posibleDuplicado: false, motivo: "sin_identificar" };
  const exactos = datos.cargosAbiertosDelCliente.filter((c) => c.saldoCentavos === abono.montoCentavos);
  if (exactos.length === 1) {
    return {
      clienteId,
      aplicacion: { cargoId: exactos[0]!.id, montoCentavos: abono.montoCentavos, regla: "clabe_y_monto" },
      posibleDuplicado: false,
      motivo: cuenta ? "cuenta_y_monto" : "clabe_y_monto",
    };
  }
  return { clienteId, aplicacion: null, posibleDuplicado: false, motivo: "cliente_sin_coincidencia" };
}

/** Saldo a favor de un pago: lo que no se ha aplicado a ningún cargo. */
export function saldoAFavor(pago: { montoCentavos: number; aplicadoCentavos: number; estado: string }): number {
  return pago.estado === "anulado" ? 0 : pago.montoCentavos - pago.aplicadoCentavos;
}
