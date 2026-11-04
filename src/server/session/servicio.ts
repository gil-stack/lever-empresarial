import { randomBytes, randomUUID } from "node:crypto";

import {
  encabezadoCerrarSesion,
  encabezadoCerrarSesionParcial,
  encabezadoDeSesion,
  encabezadoDeSesionParcial,
  leerToken,
  leerTokenParcial,
  VIGENCIA_PARCIAL_MS,
  VIGENCIA_SESION_MS,
} from "./cookie";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { hashearContrasena, hashDeToken, tokenNuevo, verificarContrasena } from "./hash";
import { repositorioPg, type RepositorioSesion } from "./repositorio";
import { METODOS_SEGUNDO_FACTOR, type MetodoSegundoFactor, type Sesion, type SesionAbierta } from "./tipos";
import { correoValido, normalizarCorreo } from "./validar";

type Hashear = (contrasena: string) => Promise<string>;
type Verificar = (contrasena: string, hash: string) => Promise<boolean>;

export type DependenciasSesion = {
  repositorio?: RepositorioSesion;
  ahora?: () => Date;
  token?: () => string;
  hashear?: Hashear;
  verificar?: Verificar;
};

const rellenos = new WeakMap<Hashear, Promise<string>>();

/**
 * La contraseña abre una sesión parcial, en la cookie `sesion_parcial`. Esa
 * cookie no abre ningún portal: solo deja verificar el segundo factor.
 * Quien no ha aceptado su invitación no tiene contraseña y no entra.
 */
export async function entrar(
  entrada: { correo?: string; contrasena?: string },
  deps?: DependenciasSesion,
): Promise<SesionAbierta> {
  const listo = resolver(deps);
  const correo = typeof entrada?.correo === "string" ? normalizarCorreo(entrada.correo) : "";
  const contrasena = typeof entrada?.contrasena === "string" ? entrada.contrasena : "";
  if (!correoValido(correo) || contrasena.length === 0) {
    throw new ErrorDeDominio("credenciales_invalidas");
  }
  const usuario = await listo.repositorio.buscarPorCorreo(correo);
  const coincide = await contrasenaCoincide(contrasena, usuario?.passwordHash ?? null, listo.hashear, listo.verificar);
  if (!coincide || !usuario) {
    await registrarFallo(listo.repositorio, usuario?.id ?? null);
    throw new ErrorDeDominio("credenciales_invalidas");
  }
  return abrirSesionDe(usuario.id, listo);
}

/** Sesión parcial para una persona que ya probó su contraseña o abrió su invitación. */
export async function abrirSesionDe(userId: string, deps?: DependenciasSesion): Promise<SesionAbierta> {
  const listo = resolver(deps);
  const token = listo.token();
  const ahora = listo.ahora();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_PARCIAL_MS);
  const setCookie = encabezadoDeSesionParcial(token, venceEn, ahora);
  await listo.repositorio.abrirSesion({
    id: randomUUID(),
    userId,
    tokenHash: hashDeToken(token),
    expiresAt: venceEn,
  });
  const parcial = await listo.repositorio.buscarPorTokenHash(hashDeToken(token), ahora, false);
  if (!parcial) throw new ErrorDeDominio("base_no_disponible");
  return { setCookie, sesion: parcial };
}

/**
 * Contrato con el verificador del segundo factor. Lo llama solo después de
 * comprobar la passkey o el código TOTP de la persona de la sesión parcial.
 * Pone la marca, cambia el token y devuelve las dos cookies: la completa y
 * el cierre de la parcial.
 */
export async function completarSegundoFactor(
  cookieHeader: string | null | undefined,
  metodo: MetodoSegundoFactor,
  deps?: DependenciasSesion,
): Promise<{ sesion: Sesion; setCookies: [string, string] }> {
  if (!(METODOS_SEGUNDO_FACTOR as readonly string[]).includes(metodo)) throw new ErrorDeDominio("entrada_invalida");
  const parcial = leerTokenParcial(cookieHeader);
  if (!parcial) throw new ErrorDeDominio("sesion_ausente");
  const listo = resolver(deps);
  const token = listo.token();
  const ahora = listo.ahora();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_SESION_MS);
  const setCookie = encabezadoDeSesion(token, venceEn, ahora);
  const sesion = await listo.repositorio.completarSegundoFactor({
    tokenHashParcial: hashDeToken(parcial),
    tokenHashCompleto: hashDeToken(token),
    metodo,
    expiresAt: venceEn,
    ahora,
  });
  return { sesion, setCookies: [setCookie, encabezadoCerrarSesionParcial()] };
}

/** Solo la sesión completa: contraseña y segundo factor verificado. */
export async function leerSesion(
  cookieHeader: string | null | undefined,
  deps?: DependenciasSesion,
): Promise<Sesion | null> {
  const token = leerToken(cookieHeader);
  if (!token) return null;
  const listo = resolver(deps);
  return listo.repositorio.buscarPorTokenHash(hashDeToken(token), listo.ahora(), true);
}

/** Para la pantalla del segundo factor: quién es la persona que lo está verificando. */
export async function leerSesionParcial(
  cookieHeader: string | null | undefined,
  deps?: DependenciasSesion,
): Promise<Sesion | null> {
  const token = leerTokenParcial(cookieHeader);
  if (!token) return null;
  const listo = resolver(deps);
  return listo.repositorio.buscarPorTokenHash(hashDeToken(token), listo.ahora(), false);
}

/** Cierra la sesión que haya, completa o parcial, y borra las dos cookies. */
export async function cerrarSesion(
  cookieHeader: string | null | undefined,
  deps?: DependenciasSesion,
): Promise<{ setCookies: [string, string] }> {
  const listo = resolver(deps);
  for (const token of [leerToken(cookieHeader), leerTokenParcial(cookieHeader)]) {
    if (token) await listo.repositorio.borrarPorTokenHash(hashDeToken(token), listo.ahora());
  }
  return { setCookies: [encabezadoCerrarSesion(), encabezadoCerrarSesionParcial()] };
}

async function registrarFallo(repositorio: RepositorioSesion, userId: string | null): Promise<void> {
  try {
    await repositorio.registrarFallo(userId);
  } catch (error) {
    // El rechazo de la entrada no depende de que su rastro se escriba.
    if (!(error instanceof ErrorDeDominio)) throw error;
  }
}

function resolver(deps?: DependenciasSesion): {
  repositorio: RepositorioSesion;
  ahora: () => Date;
  token: () => string;
  hashear: Hashear;
  verificar: Verificar;
} {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    token: deps?.token ?? tokenNuevo,
    hashear: deps?.hashear ?? hashearContrasena,
    verificar: deps?.verificar ?? verificarContrasena,
  };
}

export async function contrasenaCoincide(
  contrasena: string,
  hash: string | null,
  hashear: Hashear,
  verificar: Verificar,
): Promise<boolean> {
  if (hash) return verificar(contrasena, hash);
  await verificar(contrasena, await hashDeRelleno(hashear));
  return false;
}

function hashDeRelleno(hashear: Hashear): Promise<string> {
  let pendiente = rellenos.get(hashear);
  if (!pendiente) {
    pendiente = hashear(randomBytes(32).toString("base64url"));
    rellenos.set(hashear, pendiente);
  }
  return pendiente;
}
