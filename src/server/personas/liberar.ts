import { decidirLiberacion, hoyEnMexico } from "../../dominio/personas";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { Sesion } from "../session/tipos";
import { repositorioPg } from "./repositorio";
import { usuarioDeSesion, type DependenciasPersonas } from "./servicio";

/**
 * La acción de soltar dinero no existe en esta fase.
 *
 * El contador ni siquiera consulta el maestro: su rol no libera. Un solo
 * liberador deja la empresa inoperable. Dos firmas distintas tampoco
 * dispersan: no hay instrucción de pago ni lote.
 */
export async function negarLiberacion(
  sesion: Sesion | null | undefined,
  otraFirmaId: string | null,
  deps?: DependenciasPersonas,
): Promise<never> {
  const userId = usuarioDeSesion(sesion);
  if (sesion?.rol !== "liberador") throw new ErrorDeDominio("sin_accion_de_liberar");
  const listo = deps?.repositorio ?? repositorioPg();
  const hoy = hoyEnMexico((deps?.ahora ?? (() => new Date()))());
  const hechos = await listo.hechosLiberacion(userId, hoy);
  if (!hechos) throw new ErrorDeDominio("sin_empresa");
  throw new ErrorDeDominio(
    decidirLiberacion({
      rol: hechos.rol,
      deBaja: hechos.actorDeBaja,
      autorizados: hechos.autorizados,
      actorId: userId,
      otraFirmaId,
    }),
  );
}
