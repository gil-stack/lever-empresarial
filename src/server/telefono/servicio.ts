import { exigir, type ContextoDeTenant } from "../../nucleo/contexto";
import { repositorioPg } from "./repositorio";
import type { DatosFiscalesTelefono, InicioTelefono, RepositorioTelefono, TopeTelefono } from "./tipos";

export type DependenciasTelefono = { repositorio?: RepositorioTelefono };

export async function leerInicioTelefono(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasTelefono,
): Promise<InicioTelefono> {
  const conEmpresa = exigir(ctx, "telefono.inicio.ver");
  return (deps?.repositorio ?? repositorioPg()).inicio(conEmpresa);
}

export async function leerTopesTelefono(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasTelefono,
): Promise<TopeTelefono[]> {
  const conEmpresa = exigir(ctx, "telefono.topes.ver");
  return (deps?.repositorio ?? repositorioPg()).topes(conEmpresa);
}

export async function leerFacturacionTelefono(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasTelefono,
): Promise<DatosFiscalesTelefono | null> {
  const conEmpresa = exigir(ctx, "telefono.facturacion.ver");
  return (deps?.repositorio ?? repositorioPg()).facturacion(conEmpresa);
}
