import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Sesion } from "../session/tipos";

export const VIGENCIA_AUTORIZACION_MS = 30 * 60 * 1000;

/**
 * Cambiar un segundo factor (passkey, app autenticadora, códigos de respaldo)
 * o aprobar la recuperación de uno exige haber probado el factor hace cinco
 * minutos o menos. Una cookie robada ya no basta para dejar una puerta propia.
 */
export const VIGENCIA_FACTORES_MS = 5 * 60 * 1000;

type SesionConFactor = Pick<Sesion, "segundoFactor" | "superficie">;

/**
 * Las decisiones de activación y comisión exigen un segundo factor reciente.
 * No se piden ni guardan contraseñas en operación: para renovar la prueba, la
 * persona sale y vuelve a entrar por la puerta SOFIPO, o confirma su identidad
 * con su factor donde la pantalla lo ofrezca.
 */
export function exigirAutenticacionReciente(sesion: SesionConFactor, ahora: Date = new Date()): void {
  exigirFactorReciente(sesion, { superficie: "sofipo", vigenciaMs: VIGENCIA_AUTORIZACION_MS }, ahora);
}

/** Cambiar una CLABE o autorizar un pago exige la misma prueba reciente en el portal cliente. */
export function exigirAutenticacionRecienteCliente(sesion: SesionConFactor, ahora: Date = new Date()): void {
  exigirFactorReciente(sesion, { superficie: "cliente", vigenciaMs: VIGENCIA_AUTORIZACION_MS }, ahora);
}

/**
 * El factor de la sesión se probó dentro de `vigenciaMs`. Sin `superficie`, vale
 * la de la sesión: cada quien administra sus factores desde donde entró.
 */
export function exigirFactorReciente(
  sesion: SesionConFactor | null | undefined,
  opciones: { vigenciaMs: number; superficie?: "cliente" | "sofipo" },
  ahora: Date = new Date(),
): void {
  if (!factorReciente(sesion, opciones, ahora)) throw new ErrorDeDominio("reautenticacion_requerida");
}

export function factorReciente(
  sesion: SesionConFactor | null | undefined,
  opciones: { vigenciaMs: number; superficie?: "cliente" | "sofipo" },
  ahora: Date = new Date(),
): boolean {
  const verificado = sesion?.segundoFactor?.en;
  if (!sesion || !verificado) return false;
  if (opciones.superficie && sesion.superficie !== opciones.superficie) return false;
  const edad = ahora.getTime() - verificado.getTime();
  return edad >= 0 && edad <= opciones.vigenciaMs;
}
