import { repositorioPg } from "./repositorio";

/**
 * La sesión de `src/server/session` no sabe de segundo factor: `entrar` y
 * `abrirCuenta` siguen abriendo la suya, y el alta y las pruebas las usan.
 * El portal pregunta aquí. Sin `passkey`, `totp` o `respaldo`, esa sesión
 * no cuenta.
 *
 * Cuando el frente de tenencia guarde varias sesiones por persona, este
 * dato sigue siendo por sesión: cada una nace con su propio factor.
 */
export async function sesionTieneSegundoFactor(sessionId: string): Promise<boolean> {
  const factor = await repositorioPg().segundoFactorDeSesion(sessionId);
  return factor !== null;
}
