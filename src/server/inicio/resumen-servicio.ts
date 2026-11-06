import { hoyEnMexico } from "../../dominio/personas";
import { armarResumenInicio, type PeriodoResumen, type ResumenInicio } from "../../dominio/resumen";
import { exigir, type ContextoDeTenant } from "../../nucleo/contexto";
import { repositorioResumenPg, type RepositorioResumen } from "./resumen-repositorio";

export type DependenciasResumen = {
  repositorio?: RepositorioResumen;
  ahora?: () => Date;
};

export async function leerResumenInicio(
  ctx: ContextoDeTenant | null | undefined,
  periodo: PeriodoResumen,
  deps?: DependenciasResumen,
): Promise<ResumenInicio> {
  const conEmpresa = exigir(ctx, "cliente.resumen.ver");
  const hoy = hoyEnMexico((deps?.ahora ?? (() => new Date()))());
  const datos = await (deps?.repositorio ?? repositorioResumenPg()).leer(conEmpresa, hoy, periodo);
  return armarResumenInicio(datos, hoy, periodo);
}
