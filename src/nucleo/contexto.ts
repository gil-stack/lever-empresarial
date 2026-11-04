import type { Capacidad, RolCliente, RolPlataforma, Superficie } from "./capacidades";
import { tiene } from "./capacidades";
import type { ContextoDeBase } from "./db";
import { ErrorDeDominio } from "./error-de-dominio";

export type EmpresaDelContexto = {
  id: string;
  rfc: string;
  razonSocial: string;
  operadorId: string;
  estado: string;
  demostracion: boolean;
};

export type PersonalDelContexto = {
  operadorId: string;
  roles: readonly RolPlataforma[];
};

/**
 * Se resuelve una vez por petición. La empresa sale de la ruta y se valida
 * contra las membresías activas de la persona: elegirla no autoriza nada.
 * Los repositorios reciben este objeto y ya no deducen la empresa del usuario.
 */
export type ContextoDeTenant = {
  sesionId: string;
  peticionId: string | null;
  superficie: Superficie;
  persona: { id: string; nombre: string; correo: string };
  /**
   * Sin segundo factor verificado no hay contexto: ningún portal abre.
   * «comando» es el personal del operador en el comando de plataforma, que
   * ya entra con las credenciales directas de la base.
   */
  segundoFactor: "passkey" | "totp" | "comando";
  empresa: EmpresaDelContexto | null;
  roles: readonly RolCliente[];
  personal: PersonalDelContexto | null;
  empresas: readonly { id: string; razonSocial: string }[];
  capacidades: readonly Capacidad[];
};

export type ContextoConEmpresa = ContextoDeTenant & { empresa: EmpresaDelContexto };
export type ContextoDePersonal = ContextoDeTenant & { personal: PersonalDelContexto };

export function puede(ctx: ContextoDeTenant | null | undefined, capacidad: Capacidad): boolean {
  return Boolean(ctx && tiene(ctx.capacidades, capacidad));
}

export function exigirSesion(ctx: ContextoDeTenant | null | undefined): ContextoDeTenant {
  if (!ctx || typeof ctx.persona?.id !== "string" || !ctx.segundoFactor) throw new ErrorDeDominio("sesion_ausente");
  return ctx;
}

export function exigirEmpresa(ctx: ContextoDeTenant | null | undefined): ContextoConEmpresa {
  const conSesion = exigirSesion(ctx);
  if (!conSesion.empresa) throw new ErrorDeDominio("sin_empresa");
  return conSesion as ContextoConEmpresa;
}

/** Exige empresa y capacidad. El rechazo dice cuál de las dos faltó. */
export function exigir(ctx: ContextoDeTenant | null | undefined, capacidad: Capacidad): ContextoConEmpresa {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, capacidad)) throw new ErrorDeDominio("sin_permiso");
  return conEmpresa;
}

export function exigirPersonal(ctx: ContextoDeTenant | null | undefined, capacidad: Capacidad): ContextoDePersonal {
  const conSesion = exigirSesion(ctx);
  if (!conSesion.personal || !puede(conSesion, capacidad)) throw new ErrorDeDominio("no_es_operador");
  return conSesion as ContextoDePersonal;
}

/** Postgres ve la empresa del contexto como rol cliente. */
export function baseCliente(ctx: ContextoConEmpresa): ContextoDeBase {
  return {
    rol: "plataforma_cliente",
    companyId: ctx.empresa.id,
    userId: ctx.persona.id,
    operadorId: ctx.empresa.operadorId,
  };
}

/** Postgres ve al personal del operador, sin empresa salvo la que el acto toca. */
export function basePlataforma(ctx: ContextoDePersonal, companyId: string | null = null): ContextoDeBase {
  return {
    rol: "plataforma_sofipo",
    companyId,
    userId: ctx.persona.id,
    operadorId: ctx.personal.operadorId,
  };
}
