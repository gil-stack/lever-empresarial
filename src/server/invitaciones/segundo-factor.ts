/**
 * Contrato con la autenticación (rama fase-4/autenticacion).
 *
 * Todos entran con correo, contraseña y segundo factor: passkey, o TOTP si
 * no hay passkey. Aceptar una invitación solo prueba el correo y fija la
 * contraseña; no abre una sesión completa. Después de confirmar la
 * aceptación, este módulo entrega a la persona a la autenticación:
 *
 * - cuenta nueva: registra su segundo factor;
 * - cuenta existente: lo verifica, como en cualquier entrada.
 *
 * La autenticación devuelve el Set-Cookie de una sesión que solo sirve para
 * ese paso y la ruta a donde ir. Mientras no exista, `segundoFactorPendiente`
 * falla cerrado: la contraseña queda guardada y nadie entra.
 */

export type PasoSegundoFactor = {
  userId: string;
  cuentaNueva: boolean;
  ahora: Date;
};

export type SalidaSegundoFactor = {
  setCookie: string;
  destino: string;
};

export type ContinuarConSegundoFactor = (paso: PasoSegundoFactor) => Promise<SalidaSegundoFactor | null>;

export const segundoFactorPendiente: ContinuarConSegundoFactor = async () => null;

/** Solo rutas propias: una ruta absoluta a otro sitio sería una redirección abierta. */
export function destinoPropio(destino: unknown): destino is string {
  return typeof destino === "string" && /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(destino);
}
