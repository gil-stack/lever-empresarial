import { darDeAltaEmpresa as darDeAltaReal, leerEmpresa as leerEmpresaReal } from "../company/servicio";
import type { AltaEmpresaEntrada, Empresa } from "../company/tipos";
import { ErrorDeDominio } from "../session/error-de-dominio";
import {
  abrirCuenta as abrirCuentaReal,
  cerrarSesion as cerrarSesionReal,
  descartarCuentaSinEmpresa as descartarReal,
  entrar as entrarReal,
} from "../session/servicio";
import type { AltaCuenta, Sesion, SesionAbierta } from "../session/tipos";

type AbrirCuenta = typeof abrirCuentaReal;
type Entrar = typeof entrarReal;
type DarDeAlta = typeof darDeAltaReal;
type LeerEmpresa = typeof leerEmpresaReal;
type Descartar = typeof descartarReal;
type CerrarSesion = typeof cerrarSesionReal;

export type DependenciasCompletar = {
  abrirCuenta?: AbrirCuenta;
  entrar?: Entrar;
  darDeAltaEmpresa?: DarDeAlta;
  leerEmpresa?: LeerEmpresa;
  descartarCuentaSinEmpresa?: Descartar;
  cerrarSesion?: CerrarSesion;
};

export type ResultadoCompletar =
  | { tipo: "lista"; setCookie: string | null }
  | { tipo: "rechazo"; error: unknown; setCookie: string | null; cerrarCookie: boolean };

type DependenciasListas = {
  abrirCuenta: AbrirCuenta;
  entrar: Entrar;
  darDeAltaEmpresa: DarDeAlta;
  leerEmpresa: LeerEmpresa;
  descartarCuentaSinEmpresa: Descartar;
  cerrarSesion: CerrarSesion;
};

/**
 * La cookie no se escribe aquí. Quien llama la fija solo si este resultado
 * trae `setCookie`. Un RFC ya registrado no devuelve cookie de una cuenta nueva:
 * esa persona se borra si todavía no tiene empresa.
 */
export async function completarAlta(
  sesion: Sesion | null,
  cuenta: AltaCuenta | null,
  empresa: AltaEmpresaEntrada,
  deps?: DependenciasCompletar,
): Promise<ResultadoCompletar> {
  const listo: DependenciasListas = {
    abrirCuenta: deps?.abrirCuenta ?? abrirCuentaReal,
    entrar: deps?.entrar ?? entrarReal,
    darDeAltaEmpresa: deps?.darDeAltaEmpresa ?? darDeAltaReal,
    leerEmpresa: deps?.leerEmpresa ?? leerEmpresaReal,
    descartarCuentaSinEmpresa: deps?.descartarCuentaSinEmpresa ?? descartarReal,
    cerrarSesion: deps?.cerrarSesion ?? cerrarSesionReal,
  };
  if (sesion) return completarConSesion(sesion, empresa, listo);
  if (!cuenta) {
    return {
      tipo: "rechazo",
      error: new ErrorDeDominio("sesion_ausente"),
      setCookie: null,
      cerrarCookie: false,
    };
  }
  return completarSinSesion(cuenta, empresa, listo);
}

async function completarConSesion(
  sesion: Sesion,
  empresa: AltaEmpresaEntrada,
  deps: DependenciasListas,
): Promise<ResultadoCompletar> {
  try {
    await deps.darDeAltaEmpresa(sesion, empresa);
    return { tipo: "lista", setCookie: null };
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.codigo === "rfc_duplicado") {
      await olvidar(sesion.usuario.id, deps.descartarCuentaSinEmpresa);
      return {
        tipo: "rechazo",
        error,
        setCookie: null,
        cerrarCookie: await sigueSinEmpresa(sesion, deps.leerEmpresa),
      };
    }
    return { tipo: "rechazo", error, setCookie: null, cerrarCookie: false };
  }
}

async function completarSinSesion(
  cuenta: AltaCuenta,
  empresa: AltaEmpresaEntrada,
  deps: DependenciasListas,
): Promise<ResultadoCompletar> {
  let abierta: SesionAbierta;
  let cuentaNueva = false;
  try {
    abierta = await deps.abrirCuenta(cuenta);
    cuentaNueva = true;
  } catch (error) {
    if (!(error instanceof ErrorDeDominio) || error.codigo !== "correo_duplicado") {
      return { tipo: "rechazo", error, setCookie: null, cerrarCookie: false };
    }
    try {
      abierta = await deps.entrar({ correo: cuenta.correo, contrasena: cuenta.contrasena });
    } catch (errorEntrar) {
      return { tipo: "rechazo", error: errorEntrar, setCookie: null, cerrarCookie: false };
    }
  }

  try {
    await deps.darDeAltaEmpresa(abierta.sesion, empresa);
    return { tipo: "lista", setCookie: abierta.setCookie };
  } catch (error) {
    if (cuentaNueva || (error instanceof ErrorDeDominio && error.codigo === "rfc_duplicado")) {
      await olvidar(abierta.sesion.usuario.id, deps.descartarCuentaSinEmpresa);
    }
    if (!cuentaNueva && error instanceof ErrorDeDominio && error.codigo === "segunda_razon_social") {
      return { tipo: "rechazo", error, setCookie: abierta.setCookie, cerrarCookie: false };
    }
    if (!cuentaNueva) await cerrarSinPublicar(abierta.setCookie, deps.cerrarSesion);
    return { tipo: "rechazo", error, setCookie: null, cerrarCookie: false };
  }
}

async function olvidar(userId: string, descartar: Descartar): Promise<boolean> {
  try {
    return await descartar(userId);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return false;
    throw error;
  }
}

async function sigueSinEmpresa(sesion: Sesion, leer: LeerEmpresa): Promise<boolean> {
  try {
    const empresa: Empresa | null = await leer(sesion);
    return empresa === null;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return false;
    throw error;
  }
}

async function cerrarSinPublicar(cookie: string, cerrar: CerrarSesion): Promise<void> {
  try {
    await cerrar(cookie);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return;
    throw error;
  }
}
