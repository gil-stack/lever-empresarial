import { randomBytes } from "node:crypto";

import { encabezadoCerrarSesion, encabezadoCerrarSesionParcial, leerToken, leerTokenParcial, RENOVACION_USO_MS } from "./cookie";
import { hashDeToken } from "./hash";
import { repositorioPg, type RepositorioSesion } from "./repositorio";
import type { Sesion } from "./tipos";

type Hashear = (contrasena: string) => Promise<string>;
type Verificar = (contrasena: string, hash: string) => Promise<boolean>;

export type DependenciasSesion = {
  repositorio?: RepositorioSesion;
  ahora?: () => Date;
};

const rellenos = new WeakMap<Hashear, Promise<string>>();

/**
 * Solo la sesión completa: contraseña y segundo factor verificado. La base no
 * devuelve la sesión vencida ni la que lleva 30 minutos sin uso. Leerla cuenta
 * como uso: ultimo_uso se renueva, como mucho, una vez por minuto.
 */
export async function leerSesion(
  cookieHeader: string | null | undefined,
  deps?: DependenciasSesion,
): Promise<Sesion | null> {
  const token = leerToken(cookieHeader);
  if (!token) return null;
  const listo = resolver(deps);
  const ahora = listo.ahora();
  const sesion = await listo.repositorio.buscarPorTokenHash(hashDeToken(token), ahora, true);
  if (sesion?.ultimoUsoEn && ahora.getTime() - sesion.ultimoUsoEn.getTime() >= RENOVACION_USO_MS) {
    await listo.repositorio.renovarUso(sesion.id, sesion.usuario.id, ahora);
  }
  return sesion;
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

function resolver(deps?: DependenciasSesion): {
  repositorio: RepositorioSesion;
  ahora: () => Date;
} {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
  };
}

/** Compara la contraseña con su hash; sin hash, gasta lo mismo contra uno de relleno y responde que no. */
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
