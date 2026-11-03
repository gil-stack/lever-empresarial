import { randomBytes, randomUUID } from "node:crypto";

import { encabezadoCerrarSesion, encabezadoDeSesion, leerToken, VIGENCIA_SESION_MS } from "./cookie";
import { ErrorDeDominio } from "./error-de-dominio";
import { hashearContrasena, hashDeToken, tokenNuevo, verificarContrasena } from "./hash";
import { repositorioPg, type RepositorioSesion } from "./repositorio";
import type { AltaCuenta, Sesion, SesionAbierta } from "./tipos";
import { correoValido, normalizarCorreo, validarCuenta } from "./validar";

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

export async function abrirCuenta(
  entrada: AltaCuenta,
  deps?: DependenciasSesion,
): Promise<SesionAbierta> {
  const listo = resolver(deps);
  const cuenta = validarCuenta(entrada);
  if (!cuenta.ok) throw new ErrorDeDominio(cuenta.codigo);
  const id = randomUUID();
  const sesionId = randomUUID();
  const token = listo.token();
  const ahora = listo.ahora();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_SESION_MS);
  const setCookie = encabezadoDeSesion(token, venceEn, ahora);
  const passwordHash = await listo.hashear(cuenta.valor.contrasena);
  await listo.repositorio.crearCuenta({
    usuario: {
      id,
      nombre: cuenta.valor.nombre,
      correo: cuenta.valor.correo,
      passwordHash,
    },
    sesion: {
      id: sesionId,
      userId: id,
      tokenHash: hashDeToken(token),
      expiresAt: venceEn,
    },
  });
  return {
    setCookie,
    sesion: {
      id: sesionId,
      venceEn,
      usuario: { id, nombre: cuenta.valor.nombre, correo: cuenta.valor.correo },
      companyId: null,
      rol: null,
    },
  };
}

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
  if (!coincide || !usuario) throw new ErrorDeDominio("credenciales_invalidas");
  const sesionId = randomUUID();
  const token = listo.token();
  const ahora = listo.ahora();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_SESION_MS);
  const setCookie = encabezadoDeSesion(token, venceEn, ahora);
  await listo.repositorio.abrirSesion({
    id: sesionId,
    userId: usuario.id,
    tokenHash: hashDeToken(token),
    expiresAt: venceEn,
  });
  const vigente = await listo.repositorio.buscarPorTokenHash(hashDeToken(token), ahora);
  if (!vigente) throw new ErrorDeDominio("base_no_disponible");
  return { setCookie, sesion: vigente };
}

export async function leerSesion(
  cookieHeader: string | null | undefined,
  deps?: DependenciasSesion,
): Promise<Sesion | null> {
  const token = leerToken(cookieHeader);
  if (!token) return null;
  const listo = resolver(deps);
  return listo.repositorio.buscarPorTokenHash(hashDeToken(token), listo.ahora());
}

export async function cerrarSesion(
  cookieHeader: string | null | undefined,
  deps?: DependenciasSesion,
): Promise<{ setCookie: string }> {
  const token = leerToken(cookieHeader);
  if (token) {
    await resolver(deps).repositorio.borrarPorTokenHash(hashDeToken(token));
  }
  return { setCookie: encabezadoCerrarSesion() };
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

async function contrasenaCoincide(
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
