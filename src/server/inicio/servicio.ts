import { hoyEnMexico } from "../../dominio/personas";
import { pendientesDeInicio, type PendienteInicio } from "../../dominio/inicio";
import { exigir, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { repositorioPg, type RepositorioInicio } from "./repositorio";

export type DependenciasInicio = {
  repositorio?: RepositorioInicio;
  ahora?: () => Date;
};

export async function leerPendientesInicio(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasInicio,
): Promise<PendienteInicio[]> {
  const conEmpresa = exigir(ctx, "cliente.consola.ver");
  const configurable =
    puede(conEmpresa, "cliente.maestro.editar") ||
    puede(conEmpresa, "cliente.politica.editar") ||
    puede(conEmpresa, "cliente.plan.ver");
  if (!configurable) return [];
  const datos = await (deps?.repositorio ?? repositorioPg()).leer(
    conEmpresa,
    hoyEnMexico((deps?.ahora ?? (() => new Date()))()),
  );
  return pendientesDeInicio(datos, conEmpresa.capacidades);
}
