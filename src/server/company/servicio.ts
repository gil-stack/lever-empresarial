import { randomUUID } from "node:crypto";

import { exigirEmpresa, exigirPersonal, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { repositorioPg, type RepositorioEmpresas } from "./repositorio";
import type { AltaEmpresaEntrada, Empresa } from "./tipos";
import { validarAlta } from "./validar";

export type DependenciasEmpresa = {
  repositorio?: RepositorioEmpresas;
};

/**
 * Las empresas las da de alta el operador. Nadie crea una empresa desde una
 * ruta pública, y el alta no abre sesión ni crea membresías: al primer
 * administrador se le invita aparte.
 */
export async function darDeAltaEmpresa(
  ctx: ContextoDeTenant | null | undefined,
  entrada: AltaEmpresaEntrada,
  opciones: { demostracion: boolean },
  deps?: DependenciasEmpresa,
): Promise<Empresa> {
  const personal = exigirPersonal(ctx, "plataforma.empresa.alta");
  const validada = validarAlta(entrada);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  if (typeof opciones?.demostracion !== "boolean") throw new ErrorDeDominio("entrada_invalida");
  const repositorio = deps?.repositorio ?? repositorioPg();
  return repositorio.insertar(personal, {
    id: randomUUID(),
    ...validada.valor,
    demostracion: opciones.demostracion,
  });
}

/** La empresa del contexto. Un identificador que mande el navegador no elige ni autoriza. */
export async function leerEmpresa(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasEmpresa,
): Promise<Empresa | null> {
  const conEmpresa = exigirEmpresa(ctx);
  return (deps?.repositorio ?? repositorioPg()).leer(conEmpresa);
}
