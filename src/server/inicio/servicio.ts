import type { LineaPresupuesto } from "../../dominio/flujo/presupuestos";
import { hoyEnMexico } from "../../dominio/personas";
import { atajosDeInicio, pendientesDeInicio, pendientesDePresupuesto, type PendienteInicio } from "../../dominio/inicio";
import { exigir, puede, type ContextoConEmpresa, type ContextoDeTenant } from "../../nucleo/contexto";
import { leerAlertasPresupuesto } from "../flujo/servicio";
import { repositorioPg, type RepositorioInicio } from "./repositorio";

export type DependenciasInicio = {
  repositorio?: RepositorioInicio;
  ahora?: () => Date;
  alertasPresupuesto?: (ctx: ContextoConEmpresa, hoy: string) => Promise<LineaPresupuesto[]>;
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
  const hoy = hoyEnMexico((deps?.ahora ?? (() => new Date()))());
  // Las alertas de presupuesto son de quien ve el flujo de caja (también contaduría).
  const presupuesto = puede(conEmpresa, "cliente.flujo.ver")
    ? pendientesDePresupuesto(await (deps?.alertasPresupuesto ?? leerAlertasPresupuesto)(conEmpresa, hoy))
    : [];
  if (!configurable) return { pendientes: presupuesto, atajos };
  const datos = await (deps?.repositorio ?? repositorioPg()).leer(conEmpresa, hoy);
  return { pendientes: [...pendientesDeInicio(datos, conEmpresa.capacidades), ...presupuesto], atajos };
}
