import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Sesion } from "../session/tipos";

export const VIGENCIA_AUTORIZACION_MS = 30 * 60 * 1000;

/**
 * Las decisiones de activación y comisión exigen un segundo factor reciente.
 * No se piden ni guardan contraseñas en operación: para renovar la prueba, la
 * persona sale y vuelve a entrar por la puerta SOFIPO.
 */
export function exigirAutenticacionReciente(
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  ahora: Date = new Date(),
): void {
  exigirFactorRecienteEnSuperficie(sesion, "sofipo", ahora);
}

/** Cambiar una CLABE o autorizar un pago exige la misma prueba reciente en el portal cliente. */
export function exigirAutenticacionRecienteCliente(
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  ahora: Date = new Date(),
): void {
  exigirFactorRecienteEnSuperficie(sesion, "cliente", ahora);
}

function exigirFactorRecienteEnSuperficie(
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  superficie: "cliente" | "sofipo",
  ahora: Date,
): void {
  const verificado = sesion.segundoFactor?.en;
  if (
    sesion.superficie !== superficie ||
    !verificado ||
    verificado.getTime() > ahora.getTime() ||
    ahora.getTime() - verificado.getTime() > VIGENCIA_AUTORIZACION_MS
  ) {
    throw new ErrorDeDominio("reautenticacion_requerida");
  }
}
