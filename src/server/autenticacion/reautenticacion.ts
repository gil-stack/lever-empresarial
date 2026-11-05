import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Sesion } from "../session/tipos";

export const VIGENCIA_AUTORIZACION_MS = 30 * 60 * 1000;

/**
 * Las decisiones de activación y comisión exigen un segundo factor reciente.
 * No se piden ni guardan contraseñas en operación: para renovar la prueba, la
 * persona sale y vuelve a entrar por la puerta SOFIPO. En el portal del
 * cliente, cambiar la CLABE de nómina de una persona exige lo mismo por la
 * puerta del cliente.
 */
export function exigirAutenticacionReciente(
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  ahora: Date = new Date(),
  superficie: "sofipo" | "cliente" = "sofipo",
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
