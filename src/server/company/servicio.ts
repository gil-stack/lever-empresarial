import { exigirEmpresa, type ContextoDeTenant } from "../../nucleo/contexto";
import { repositorioPg, type RepositorioEmpresas } from "./repositorio";
import type { Empresa } from "./tipos";

export type DependenciasEmpresa = {
  repositorio?: RepositorioEmpresas;
};

/** La empresa del contexto. Un identificador que mande el navegador no elige ni autoriza. */
export async function leerEmpresa(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasEmpresa,
): Promise<Empresa | null> {
  const conEmpresa = exigirEmpresa(ctx);
  return (deps?.repositorio ?? repositorioPg()).leer(conEmpresa);
}
