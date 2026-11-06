import { hoyEnMexico } from "../../dominio/personas";
import { atajosDeInicio, pendientesDeInicio, type PendienteInicio } from "../../dominio/inicio";
import { exigir, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { repositorioPg, type RepositorioInicio } from "./repositorio";

export type DependenciasInicio = {
  repositorio?: RepositorioInicio;
  ahora?: () => Date;
};

export type BandejaInicio = {
  pendientes: PendienteInicio[];
  atajos: PendienteInicio[];
};

export async function leerPendientesInicio(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasInicio,
): Promise<PendienteInicio[]> {
  return (await leerBandejaInicio(ctx, deps)).pendientes;
}

export async function leerBandejaInicio(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasInicio,
): Promise<BandejaInicio> {
  const conEmpresa = exigir(ctx, "cliente.consola.ver");
  const configurable =
    puede(conEmpresa, "cliente.maestro.editar") ||
    puede(conEmpresa, "cliente.politica.editar") ||
    puede(conEmpresa, "cliente.proveedores.alta") ||
    puede(conEmpresa, "cliente.plan.ver") ||
    puede(conEmpresa, "cliente.pago.liberar") ||
    puede(conEmpresa, "cliente.pago.solicitar");
  const atajos = atajosDeInicio(conEmpresa.capacidades);
  if (!configurable) return { pendientes: [], atajos };
  const datos = await (deps?.repositorio ?? repositorioPg()).leer(
    conEmpresa,
    hoyEnMexico((deps?.ahora ?? (() => new Date()))()),
  );
  return { pendientes: pendientesDeInicio(datos, conEmpresa.capacidades), atajos };
}
