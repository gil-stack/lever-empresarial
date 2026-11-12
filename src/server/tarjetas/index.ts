import "server-only";

import { exigirEmpresa, puede, type ContextoConEmpresa, type ContextoDeTenant } from "@/nucleo/contexto";
import { ErrorDeDominio } from "@/nucleo/error-de-dominio";
import type { MovimientoTarjeta, OperacionTarjeta, TarjetaEmpresa, TarjetasEmpresa } from "@/dominio/tarjetas/vista";

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

/** Las tarjetas de la empresa, su saldo en Efevoo y lo que pide atención; nulo si la empresa no está vinculada. */
export async function leerTarjetasEmpresa(ctx: ContextoDeTenant | null): Promise<TarjetasEmpresa | null> {
  exigirVer(ctx);
  return null;
}

export type TarjetaDelTitular = { readonly tarjeta: TarjetaEmpresa; readonly movimientos: readonly MovimientoTarjeta[] | null };

/**
 * Las tarjetas del titular en el teléfono: solo las suyas (la RLS de la 0033 deja ver al empleado con `user_id` igual
 * al de la sesión), con su saldo y sus movimientos. Nulo si la empresa no está vinculada a Efevoo.
 */
export async function leerMisTarjetas(ctx: ContextoDeTenant | null): Promise<readonly TarjetaDelTitular[] | null> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "telefono.tarjetas.ver")) throw new ErrorDeDominio("sin_permiso");
  return null;
}

export type DetalleTarjeta = {
  readonly tarjeta: TarjetaEmpresa;
  /** Los movimientos en Efevoo, del más nuevo al más viejo; nulo si el emisor no respondió. */
  readonly movimientos: readonly MovimientoTarjeta[] | null;
  /** Lo que Lever le pidió al emisor sobre esta tarjeta, con su estado. */
  readonly operaciones: readonly OperacionTarjeta[];
};

/** Una tarjeta de la empresa con sus movimientos y operaciones; nulo si no es de esta empresa (la página da 404). */
export async function leerDetalleTarjeta(ctx: ContextoDeTenant | null, tarjetaId: string): Promise<DetalleTarjeta | null> {
  exigirVer(ctx);
  void tarjetaId;
  return null;
}

export type EntradaSaldo = { readonly tarjetaId: string; readonly tipo: "carga" | "retiro"; readonly centavos: number; readonly intento: string };

/** Carga o retira saldo de una tarjeta desde (o hacia) el saldo de la empresa en Efevoo. */
export async function moverSaldoTarjeta(ctx: ContextoDeTenant | null, entrada: EntradaSaldo): Promise<ResultadoOperacion> {
  exigirOperar(ctx);
  void entrada;
  throw new ErrorDeDominio("efevoo_no_configurado");
}

export type EntradaBloqueo = { readonly tarjetaId: string; readonly accion: "bloqueo" | "desbloqueo"; readonly intento: string };

export async function cambiarBloqueoTarjeta(ctx: ContextoDeTenant | null, entrada: EntradaBloqueo): Promise<ResultadoOperacion> {
  exigirOperar(ctx);
  void entrada;
  throw new ErrorDeDominio("efevoo_no_configurado");
}

/** Busca la referencia de una operación incierta en los movimientos de Efevoo: si aparece queda confirmada. */
export async function conciliarOperacionTarjeta(ctx: ContextoDeTenant | null, operacionId: string): Promise<OperacionTarjeta> {
  exigirOperar(ctx);
  void operacionId;
  throw new ErrorDeDominio("efevoo_no_configurado");
}

/** Una operación incierta que no apareció en Efevoo: la persona decide reintentar, con una referencia nueva ligada. */
export async function reintentarOperacionTarjeta(ctx: ContextoDeTenant | null, operacionId: string, intento: string): Promise<ResultadoOperacion> {
  exigirOperar(ctx);
  void operacionId;
  void intento;
  throw new ErrorDeDominio("efevoo_no_configurado");
}
