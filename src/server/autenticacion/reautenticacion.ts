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
  const verificado = sesion.segundoFactor?.en;
  if (
    sesion.superficie !== "sofipo" ||
    !verificado ||
    verificado.getTime() > ahora.getTime() ||
    ahora.getTime() - verificado.getTime() > VIGENCIA_AUTORIZACION_MS
  ) {
    throw new ErrorDeDominio("reautenticacion_requerida");
  }
}
