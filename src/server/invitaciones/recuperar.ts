import { randomUUID } from "node:crypto";

import { ErrorDeCorreo } from "../correo/errores";
import { plantillaRecuperarContrasena } from "../correo/plantillas/recuperar-contrasena";
import type { Enviador } from "../correo/tipos";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { hashearContrasena } from "../session/hash";
import { contrasenaValida, correoValido, normalizarCorreo } from "../session/validar";
import { registrarHechoAcceso, type Auditar } from "./auditar";
import { auditarEn, resolverEnvio } from "./comun";
import { repositorioRecuperacionPg } from "./repositorio";
import {
  hashDeToken,
  RECUPERACIONES_POR_HORA,
  tokenConForma,
  tokenNuevo,
  VIGENCIA_RECUPERACION_MS,
} from "./token";
import type { RepositorioRecuperacion } from "./tipos";

const HORA_MS = 60 * 60 * 1000;

export type DependenciasRecuperacion = {
  repositorio?: RepositorioRecuperacion;
  enviador?: Enviador;
  urlBase?: string;
  ahora?: () => Date;
  token?: () => string;
  hashear?: (contrasena: string) => Promise<string>;
  auditar?: Auditar;
};

export type EstadoRecuperacion = "vigente" | "vencida" | "no_valida";

/**
 * Responde igual exista o no la cuenta: la pantalla no dice quién tiene
 * acceso. Pasado el tope por hora tampoco avisa; solo deja de mandar.
 */
export async function solicitarRecuperacion(
  entrada: { correo?: unknown },
  deps?: DependenciasRecuperacion,
): Promise<void> {
  const envio = resolverEnvio(deps);
  const listo = resolver(deps);
  const correo = typeof entrada.correo === "string" ? normalizarCorreo(entrada.correo) : "";
  if (!correoValido(correo)) throw new ErrorDeDominio("correo_invalido");
  const cuenta = await listo.repositorio.cuentaPorCorreo(correo);
  if (!cuenta) return;

  const token = listo.token();
  const id = randomUUID();
  const ahora = listo.ahora();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_RECUPERACION_MS);

  const toca = await listo.repositorio.conTransaccion(async (tx) => {
    if ((await tx.recientes(cuenta.id, new Date(ahora.getTime() - HORA_MS))) >= RECUPERACIONES_POR_HORA) {
      return false;
    }
    await tx.anularPendientes(cuenta.id, ahora);
    await tx.insertar({ id, userId: cuenta.id, tokenHash: hashDeToken(token), creadoEn: ahora, venceEn });
    await auditarEn(listo.auditar, tx.consulta, {
      companyId: null,
      actorId: null,
      accion: "recuperacion_solicitada",
      entidad: "password_resets",
      identificador: id,
      ocurridoEn: ahora,
    });
    return true;
  });
  if (!toca) return;

  const plantilla = plantillaRecuperarContrasena({
    nombre: cuenta.nombre,
    enlace: `${envio.urlBase}/recuperar/${token}`,
    venceEn,
  });
  try {
    await envio.enviador({
      para: cuenta.correo,
      ...plantilla,
      idempotencia: `recuperacion/${id}`,
      etiqueta: "recuperar_contrasena",
    });
  } catch (error) {
    try {
      await listo.repositorio.conTransaccion((tx) => tx.anular(id, listo.ahora()));
    } catch {
      // Si no se puede anular, vence en una hora y nadie tiene el enlace.
    }
    throw error instanceof ErrorDeDominio ? error : new ErrorDeCorreo("correo_no_disponible");
  }
}

export async function leerRecuperacion(
  token: unknown,
  deps?: DependenciasRecuperacion,
): Promise<EstadoRecuperacion> {
  if (!tokenConForma(token)) return "no_valida";
  const listo = resolver(deps);
  const leida = await listo.repositorio.buscarPorTokenHash(hashDeToken(token));
  if (!leida || leida.usadoEn || leida.anuladoEn) return "no_valida";
  if (leida.venceEn.getTime() <= listo.ahora().getTime()) return "vencida";
  return "vigente";
}

/**
 * Cambia la contraseña con un token de un solo uso y cierra todas las
 * sesiones de la persona, incluida la de quien pudo haberla robado.
 *
 * No abre sesión y no toca el segundo factor: quien recupera la contraseña
 * entra después por la puerta normal, con la contraseña nueva y su factor.
 * Perder el factor no se resuelve por correo.
 */
export async function restablecerContrasena(
  entrada: { token?: unknown; contrasena?: unknown; confirmacion?: unknown },
  deps?: DependenciasRecuperacion,
): Promise<void> {
  const token = entrada.token;
  if (!tokenConForma(token)) throw new ErrorDeDominio("recuperacion_no_valida");
  const listo = resolver(deps);
  const estado = await leerRecuperacion(token, deps);
  if (estado === "vencida") throw new ErrorDeDominio("recuperacion_vencida");
  if (estado !== "vigente") throw new ErrorDeDominio("recuperacion_no_valida");

  const contrasena = typeof entrada.contrasena === "string" ? entrada.contrasena : "";
  if (!contrasenaValida(contrasena)) throw new ErrorDeDominio("contrasena_invalida");
  if (entrada.confirmacion !== contrasena) throw new ErrorDeDominio("contrasenas_distintas");
  let passwordHash: string;
  try {
    passwordHash = await listo.hashear(contrasena);
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("contrasena_no_disponible");
  }

  const ahora = listo.ahora();
  await listo.repositorio.conTransaccion(async (tx) => {
    const userId = await tx.consumir(hashDeToken(token), ahora);
    if (!userId) throw new ErrorDeDominio("recuperacion_no_valida");
    await tx.cambiarContrasena(userId, passwordHash);
    await tx.marcarCorreoVerificado(userId, ahora);
    await tx.cerrarSesiones(userId);
    await tx.anularPendientes(userId, ahora);
    await auditarEn(listo.auditar, tx.consulta, {
      companyId: null,
      actorId: userId,
      accion: "contrasena_restablecida",
      entidad: "users",
      identificador: userId,
      ocurridoEn: ahora,
    });
  });
}

function resolver(deps?: DependenciasRecuperacion) {
  return {
    repositorio: deps?.repositorio ?? repositorioRecuperacionPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    token: deps?.token ?? tokenNuevo,
    hashear: deps?.hashear ?? hashearContrasena,
    auditar: deps?.auditar ?? registrarHechoAcceso,
  };
}
