import { decidirLiberacion, hoyEnMexico } from "../../dominio/personas";
import { exigirEmpresa, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { repositorioPg } from "./repositorio";
import type { DependenciasPersonas } from "./servicio";

/**
 * La acción de soltar dinero no existe en esta fase.
 *
 * El contador ve el maestro y no libera. Un solo liberador deja la empresa
 * inoperable. Dos personas distintas tampoco dispersan: no hay instrucción
 * de pago. Esta función no abre una pantalla.
 */
export async function negarLiberacion(
  ctx: ContextoDeTenant | null | undefined,
  otraFirmaId: string | null,
  deps?: DependenciasPersonas,
): Promise<never> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.pago.liberar")) throw new ErrorDeDominio("sin_accion_de_liberar");
  const repositorio = deps?.repositorio ?? repositorioPg();
  const hoy = hoyEnMexico((deps?.ahora ?? (() => new Date()))());
  const hechos = await repositorio.hechosLiberacion(conEmpresa, hoy);
  const codigo = decidirLiberacion({
    roles: conEmpresa.roles,
    deBaja: hechos.actorDeBaja,
    autorizados: hechos.autorizados,
    actorId: conEmpresa.persona.id,
    otraFirmaId,
  });
  if (conEmpresa.empresa.demostracion && codigo === "sin_dispersion") {
    throw new ErrorDeDominio("demostracion_no_mueve_dinero");
  }
  throw new ErrorDeDominio(codigo);
}
