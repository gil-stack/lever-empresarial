import { leerCentavosEscritos } from "../centavos";

/**
 * Lo que pinta Tarjetas cuando la empresa está vinculada a Efevoo Pay (el emisor). Solo la terminación de cada tarjeta:
 * el número completo y el CVV no se piden, no se guardan y no llegan al navegador. Montos en centavos enteros.
 */

export const ESTADOS_TARJETA = ["asignada", "activa", "bloqueada", "cancelada"] as const;
export type EstadoTarjeta = (typeof ESTADOS_TARJETA)[number];

export const ESTADOS_OPERACION = ["pendiente", "confirmada", "fallida", "incierta"] as const;
export type EstadoOperacion = (typeof ESTADOS_OPERACION)[number];

/** Las operaciones que la empresa hace sobre una tarjeta. */
export const TIPOS_OPERACION_TARJETA = ["carga", "retiro", "bloqueo", "desbloqueo"] as const;
export type TipoOperacionTarjeta = (typeof TIPOS_OPERACION_TARJETA)[number];

export type OperacionTarjeta = {
  readonly id: string;
  readonly tipo: TipoOperacionTarjeta;
  /** Nulo en bloqueo y desbloqueo. */
  readonly montoCentavos: number | null;
  readonly estado: EstadoOperacion;
  /** La referencia que se manda a Efevoo (7 caracteres como máximo) y con la que se concilia. */
  readonly referencia: string;
  readonly creadaEn: string;
  /** El código de Efevoo cuando rechazó, para decirlo en palabras. */
  readonly codigoEfevoo: string | null;
  /** Si es el reintento de una operación incierta que no apareció en Efevoo. */
  readonly reintentoDe: string | null;
  /** Incierta que ya se buscó en Efevoo y no apareció: se puede reintentar (con referencia nueva). */
  readonly buscadaSinEncontrar: boolean;
};

export type TarjetaEmpresa = {
  readonly id: string;
  readonly terminacion: string;
  /** El nombre impreso o el que le puso la empresa; nunca el número. */
  readonly nombre: string;
  /** Nombre del titular para la empresa; nulo si la tarjeta no está asignada a una persona. */
  readonly titular: string | null;
  readonly estado: EstadoTarjeta;
  /** Nulo si Efevoo no respondió el saldo. */
  readonly saldoCentavos: number | null;
};

export type MovimientoTarjeta = {
  readonly fecha: string;
  readonly concepto: string;
  /** Con signo como lo da el emisor; nulo si no se pudo leer el importe. */
  readonly montoCentavos: number | null;
};

/** El saldo de la empresa en Efevoo, del que salen las cargas a tarjetas. */
export type SaldoEmpresa = { readonly tipo: "listo"; readonly centavos: number } | { readonly tipo: "no_disponible" };

export type TarjetasEmpresa = {
  readonly saldo: SaldoEmpresa;
  readonly tarjetas: readonly TarjetaEmpresa[];
  /** Operaciones que piden atención: pendientes e inciertas, de la más nueva a la más vieja. */
  readonly porAtender: readonly (OperacionTarjeta & { readonly terminacion: string })[];
};

export const ETIQUETA_ESTADO_TARJETA: Record<EstadoTarjeta, string> = {
  asignada: "Por activar",
  activa: "Activa",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

export const TONO_ESTADO_TARJETA: Record<EstadoTarjeta, "acento" | "aviso" | "peligro" | "tenue"> = {
  asignada: "aviso",
  activa: "acento",
  bloqueada: "peligro",
  cancelada: "tenue",
};

export const ETIQUETA_ESTADO_OPERACION: Record<EstadoOperacion, string> = {
  pendiente: "En proceso",
  confirmada: "Confirmada",
  fallida: "No se hizo",
  incierta: "Sin confirmar",
};

export const ETIQUETA_TIPO_OPERACION: Record<TipoOperacionTarjeta, string> = {
  carga: "Carga de saldo",
  retiro: "Retiro de saldo",
  bloqueo: "Bloqueo",
  desbloqueo: "Desbloqueo",
};

/** Solo cuatro dígitos: cualquier otra cosa no se pinta (nunca un número completo). */
export function terminacionSegura(valor: string): string {
  return /^\d{4}$/.test(valor) ? valor : "····";
}

/** Una tarjeta cancelada ya no se opera; una por activar todavía no. */
export function operable(tarjeta: Pick<TarjetaEmpresa, "estado">): boolean {
  return tarjeta.estado === "activa" || tarjeta.estado === "bloqueada";
}

export type MontoTarjeta =
  | { readonly tipo: "valido"; readonly centavos: number }
  | { readonly tipo: "invalido"; readonly motivo: "monto_invalido" | "saldo_insuficiente" };

/**
 * El monto de una carga o un retiro: pesos con centavos, mayor que cero, y que alcance. Para cargar alcanza el saldo de
 * la empresa; para retirar, el de la tarjeta. Si el saldo no se conoce, se deja pasar y lo dice Efevoo.
 */
export function leerMontoTarjeta(texto: unknown, disponibleCentavos: number | null): MontoTarjeta {
  const leido = leerCentavosEscritos(texto);
  if (leido.tipo !== "centavos" || leido.centavos <= 0 || leido.centavos > 99_999_999_99) return { tipo: "invalido", motivo: "monto_invalido" };
  if (disponibleCentavos !== null && leido.centavos > disponibleCentavos) return { tipo: "invalido", motivo: "saldo_insuficiente" };
  return { tipo: "valido", centavos: leido.centavos };
}

/** Las cifras de arriba: tarjetas activas, saldo para tarjetas, saldo repartido y bloqueadas. */
export function cifrasTarjetas(datos: Pick<TarjetasEmpresa, "saldo" | "tarjetas">): {
  activas: number;
  bloqueadas: number;
  saldoEmpresaCentavos: number | null;
  repartidoCentavos: number | null;
} {
  const vivas = datos.tarjetas.filter((t) => t.estado !== "cancelada");
  const conSaldo = vivas.map((t) => t.saldoCentavos);
  return {
    activas: vivas.filter((t) => t.estado === "activa").length,
    bloqueadas: vivas.filter((t) => t.estado === "bloqueada").length,
    saldoEmpresaCentavos: datos.saldo.tipo === "listo" ? datos.saldo.centavos : null,
    repartidoCentavos: conSaldo.some((s) => s === null) ? null : conSaldo.reduce<number>((suma, s) => suma + (s ?? 0), 0),
  };
}

/**
 * El concepto de un movimiento tal como lo manda el emisor, sin ningún número de tarjeta: cualquier secuencia de 13 o
 * más dígitos (aunque venga partida con espacios o guiones) se pinta como su terminación.
 */
export function conceptoSeguro(texto: string): string {
  return texto.replace(/\d(?:[ -]?\d){12,}/g, (secuencia) => `••${secuencia.replace(/\D/g, "").slice(-4)}`);
}

/** Una incierta solo puede quedar como «no apareció» 10 minutos después de la llamada (el emisor puede tardar en reflejarla). */
export const ESPERA_CONCILIACION_MS = 10 * 60 * 1000;

/** Minutos que faltan para que una incierta se pueda dar por no aparecida; 0 si ya se puede. */
export function minutosParaConciliar(creadaEn: string, ahora: Date): number {
  const falta = new Date(creadaEn).getTime() + ESPERA_CONCILIACION_MS - ahora.getTime();
  return falta > 0 ? Math.ceil(falta / 60_000) : 0;
}
