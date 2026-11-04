import { randomUUID } from "node:crypto";

import { ErrorDeCorreo } from "../correo/errores";
import { plantillaInvitacionEmpresa } from "../correo/plantillas/invitacion-empresa";
import { plantillaInvitacionUsuario } from "../correo/plantillas/invitacion-usuario";
import type { Enviador } from "../correo/tipos";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { hashearContrasena, verificarContrasena } from "../session/hash";
import { ROLES, type Rol } from "../session/tipos";
import { contrasenaValida, correoValido, normalizarCorreo, normalizarNombre } from "../session/validar";
import { registrarHechoAcceso, type Auditar } from "./auditar";
import { auditarEn, resolverEnvio, UUID, type Envio } from "./comun";
import { repositorioInvitacionesPg } from "./repositorio";
import {
  destinoPropio,
  segundoFactorPendiente,
  type ContinuarConSegundoFactor,
  type SalidaSegundoFactor,
} from "./segundo-factor";
import { hashDeToken, tokenConForma, tokenNuevo, VIGENCIA_INVITACION_MS } from "./token";
import type { ContextoInvitacion, RepositorioInvitaciones, TipoInvitacion } from "./tipos";

export type DependenciasInvitaciones = {
  repositorio?: RepositorioInvitaciones;
  enviador?: Enviador;
  urlBase?: string;
  ahora?: () => Date;
  token?: () => string;
  hashear?: (contrasena: string) => Promise<string>;
  verificar?: (contrasena: string, hash: string) => Promise<boolean>;
  auditar?: Auditar;
  segundoFactor?: ContinuarConSegundoFactor;
};

/**
 * `siguiente` vacío: la aceptación quedó, pero la autenticación todavía no
 * puede pedir el segundo factor, así que no hay sesión.
 */
export type InvitacionAceptada = { cuentaNueva: boolean; siguiente: SalidaSegundoFactor | null };

export type InvitacionEnviada = { invitacionId: string; venceEn: Date };

export type LecturaInvitacion =
  | {
      estado: "vigente";
      nombre: string;
      correo: string;
      razonSocial: string;
      roles: Rol[];
      quienInvita: string | null;
      venceEn: Date;
      cuentaExistente: boolean;
    }
  | { estado: "vencida" }
  | { estado: "no_valida" };

/** La administración de una empresa invita a una persona con uno o varios roles. */
export async function invitarUsuario(
  contexto: ContextoInvitacion,
  entrada: { correo?: unknown; nombre?: unknown; roles?: unknown },
  deps?: DependenciasInvitaciones,
): Promise<InvitacionEnviada> {
  if (!contexto.capacidades.has("invitar_usuarios") || !contexto.companyId || !contexto.actorId) {
    throw new ErrorDeDominio("sin_permiso");
  }
  const envio = resolverEnvio(deps);
  const listo = resolver(deps);
  const roles = leerRoles(entrada.roles);
  if (roles.length > 1 && !listo.repositorio.rolesCombinables) {
    throw new ErrorDeDominio("roles_combinados_pendientes");
  }
  return crearInvitacion(
    contexto,
    { companyId: contexto.companyId, tipo: "usuario", ...persona(entrada), roles },
    listo,
    envio,
  );
}

/** El personal abre una empresa y manda la invitación a su primera administradora. */
export async function invitarEmpresa(
  contexto: ContextoInvitacion,
  entrada: { companyId?: unknown; correo?: unknown; nombre?: unknown },
  deps?: DependenciasInvitaciones,
): Promise<InvitacionEnviada> {
  if (!contexto.capacidades.has("invitar_empresa")) throw new ErrorDeDominio("sin_permiso");
  const envio = resolverEnvio(deps);
  const listo = resolver(deps);
  const companyId = typeof entrada.companyId === "string" ? entrada.companyId.trim() : "";
  if (!UUID.test(companyId)) throw new ErrorDeDominio("empresa_ausente");
  return crearInvitacion(
    contexto,
    { companyId, tipo: "empresa", ...persona(entrada), roles: ["administrador"] },
    listo,
    envio,
  );
}

export async function revocarInvitacion(
  contexto: ContextoInvitacion,
  invitacionId: unknown,
  deps?: DependenciasInvitaciones,
): Promise<void> {
  if (!contexto.capacidades.has("invitar_usuarios") || !contexto.companyId || !contexto.actorId) {
    throw new ErrorDeDominio("sin_permiso");
  }
  if (typeof invitacionId !== "string" || !UUID.test(invitacionId)) {
    throw new ErrorDeDominio("invitacion_no_valida");
  }
  const listo = resolver(deps);
  const { companyId, actorId } = contexto;
  await listo.repositorio.conTransaccion(async (tx) => {
    const ahora = listo.ahora();
    if (!(await tx.revocar(invitacionId, companyId, ahora))) throw new ErrorDeDominio("invitacion_no_valida");
    await auditarEn(listo.auditar, tx.consulta, {
      companyId,
      actorId,
      accion: "invitacion_revocada",
      entidad: "invitations",
      identificador: invitacionId,
      ocurridoEn: ahora,
    });
  });
}

/** Abrir el enlace no gasta el token: los escáneres de correo también lo abren. */
export async function leerInvitacion(
  token: unknown,
  deps?: DependenciasInvitaciones,
): Promise<LecturaInvitacion> {
  if (!tokenConForma(token)) return { estado: "no_valida" };
  const listo = resolver(deps);
  const leida = await listo.repositorio.buscarPorTokenHash(hashDeToken(token));
  if (!leida || leida.aceptadaEn || leida.revocadaEn) return { estado: "no_valida" };
  if (leida.venceEn.getTime() <= listo.ahora().getTime()) return { estado: "vencida" };
  return {
    estado: "vigente",
    nombre: leida.nombre,
    correo: leida.correo,
    razonSocial: leida.razonSocial,
    roles: leida.roles,
    quienInvita: leida.quienInvita,
    venceEn: leida.venceEn,
    cuentaExistente: leida.cuentaExistente,
  };
}

/**
 * La persona elige su contraseña (o, si ya tiene cuenta, prueba la suya). El
 * token se gasta en la misma transacción que crea la cuenta y la membresía:
 * si algo falla, el enlace sigue sirviendo. Aceptar no abre sesión; la
 * entrada sigue en el segundo factor.
 */
export async function aceptarInvitacion(
  entrada: { token?: unknown; contrasena?: unknown; confirmacion?: unknown },
  deps?: DependenciasInvitaciones,
): Promise<InvitacionAceptada> {
  const token = entrada.token;
  if (!tokenConForma(token)) throw new ErrorDeDominio("invitacion_no_valida");
  const listo = resolver(deps);
  const tokenHash = hashDeToken(token);
  const leida = await listo.repositorio.buscarPorTokenHash(tokenHash);
  if (!leida || leida.aceptadaEn || leida.revocadaEn) throw new ErrorDeDominio("invitacion_no_valida");
  if (leida.venceEn.getTime() <= listo.ahora().getTime()) throw new ErrorDeDominio("invitacion_vencida");

  const contrasena = typeof entrada.contrasena === "string" ? entrada.contrasena : "";
  const cuenta = await listo.repositorio.cuentaPorCorreo(leida.correo);
  let nueva: { id: string; passwordHash: string } | null = null;
  let userId: string;
  if (cuenta) {
    if (!contrasena || !(await listo.verificar(contrasena, cuenta.passwordHash))) {
      throw new ErrorDeDominio("credenciales_invalidas");
    }
    userId = cuenta.id;
  } else {
    if (!contrasenaValida(contrasena)) throw new ErrorDeDominio("contrasena_invalida");
    if (entrada.confirmacion !== contrasena) throw new ErrorDeDominio("contrasenas_distintas");
    userId = randomUUID();
    nueva = { id: userId, passwordHash: await hashSeguro(listo.hashear, contrasena) };
  }

  const ahora = listo.ahora();
  await listo.repositorio.conTransaccion(async (tx) => {
    if (nueva) {
      await tx.crearUsuario({
        id: nueva.id,
        nombre: leida.nombre,
        correo: leida.correo,
        passwordHash: nueva.passwordHash,
        verificadoEn: ahora,
      });
    } else {
      await tx.marcarCorreoVerificado(userId, ahora);
    }
    const consumida = await tx.consumir(tokenHash, ahora, userId);
    if (!consumida || consumida.correo !== leida.correo) throw new ErrorDeDominio("invitacion_no_valida");
    await tx.unirAEmpresa({ userId, companyId: consumida.companyId, roles: consumida.roles });
    await auditarEn(listo.auditar, tx.consulta, {
      companyId: consumida.companyId,
      actorId: userId,
      accion: "invitacion_aceptada",
      entidad: "invitations",
      identificador: consumida.id,
      ocurridoEn: ahora,
    });
  });

  const cuentaNueva = nueva !== null;
  return {
    cuentaNueva,
    siguiente: await entregarASegundoFactor(listo.segundoFactor, { userId, cuentaNueva, ahora }),
  };
}

async function entregarASegundoFactor(
  continuar: ContinuarConSegundoFactor,
  paso: { userId: string; cuentaNueva: boolean; ahora: Date },
): Promise<SalidaSegundoFactor | null> {
  try {
    const salida = await continuar(paso);
    if (!salida || typeof salida.setCookie !== "string" || !destinoPropio(salida.destino)) return null;
    return { setCookie: salida.setCookie, destino: salida.destino };
  } catch {
    // La aceptación ya quedó. Sin el paso del segundo factor no hay sesión.
    return null;
  }
}

type Datos = {
  companyId: string;
  tipo: TipoInvitacion;
  correo: string;
  nombre: string;
  roles: readonly Rol[];
};

async function crearInvitacion(
  contexto: ContextoInvitacion,
  datos: Datos,
  listo: Resuelto,
  envio: Envio,
): Promise<InvitacionEnviada> {
  const repo = listo.repositorio;
  const empresa = await repo.empresa(datos.companyId);
  if (!empresa) throw new ErrorDeDominio("empresa_ausente");
  if (await repo.esMiembro(datos.correo, datos.companyId)) throw new ErrorDeDominio("ya_es_miembro");
  const quienInvita = contexto.actorId ? await repo.nombreDe(contexto.actorId) : null;

  const token = listo.token();
  const id = randomUUID();
  const ahora = listo.ahora();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_INVITACION_MS);

  await repo.conTransaccion(async (tx) => {
    for (const anterior of await tx.revocarPendientes(datos.companyId, datos.correo, ahora)) {
      await auditarEn(listo.auditar, tx.consulta, {
        companyId: datos.companyId,
        actorId: contexto.actorId,
        accion: "invitacion_revocada",
        entidad: "invitations",
        identificador: anterior,
        ocurridoEn: ahora,
      });
    }
    await tx.insertar({
      id,
      companyId: datos.companyId,
      tipo: datos.tipo,
      correo: datos.correo,
      nombre: datos.nombre,
      roles: datos.roles,
      tokenHash: hashDeToken(token),
      invitadoPor: contexto.actorId,
      creadaEn: ahora,
      venceEn,
    });
    await auditarEn(listo.auditar, tx.consulta, {
      companyId: datos.companyId,
      actorId: contexto.actorId,
      accion: "invitacion_creada",
      entidad: "invitations",
      identificador: id,
      ocurridoEn: ahora,
    });
  });

  const enlace = `${envio.urlBase}/invitacion/${token}`;
  const plantilla =
    datos.tipo === "empresa"
      ? plantillaInvitacionEmpresa({
          nombre: datos.nombre,
          razonSocial: empresa.razonSocial,
          rfc: empresa.rfc,
          enlace,
          venceEn,
        })
      : plantillaInvitacionUsuario({
          nombre: datos.nombre,
          razonSocial: empresa.razonSocial,
          quienInvita,
          roles: datos.roles,
          enlace,
          venceEn,
        });

  try {
    await envio.enviador({
      para: datos.correo,
      ...plantilla,
      idempotencia: `invitacion/${id}`,
      etiqueta: `invitacion_${datos.tipo}`,
    });
  } catch (error) {
    await retirarSinCorreo(id, datos.companyId, contexto.actorId, listo);
    throw error instanceof ErrorDeDominio ? error : new ErrorDeCorreo("correo_no_disponible");
  }
  return { invitacionId: id, venceEn };
}

/** Sin correo nadie tiene el enlace. Se revoca para no dejar una pendiente muda. */
async function retirarSinCorreo(id: string, companyId: string, actorId: string | null, listo: Resuelto) {
  try {
    await listo.repositorio.conTransaccion(async (tx) => {
      const ahora = listo.ahora();
      if (!(await tx.revocar(id, companyId, ahora))) return;
      await auditarEn(listo.auditar, tx.consulta, {
        companyId,
        actorId,
        accion: "invitacion_revocada",
        entidad: "invitations",
        identificador: id,
        ocurridoEn: ahora,
      });
    });
  } catch {
    // Si tampoco se puede revocar, la invitación vence sola y nadie tiene su enlace.
  }
}

function persona(entrada: { correo?: unknown; nombre?: unknown }): { correo: string; nombre: string } {
  const correo = typeof entrada.correo === "string" ? normalizarCorreo(entrada.correo) : "";
  if (!correoValido(correo)) throw new ErrorDeDominio("correo_invalido");
  const nombre = normalizarNombre(entrada.nombre);
  if (!nombre) throw new ErrorDeDominio("nombre_invalido");
  return { correo, nombre };
}

function leerRoles(valor: unknown): Rol[] {
  const lista = Array.isArray(valor) ? valor : typeof valor === "string" ? [valor] : [];
  const roles: Rol[] = [];
  for (const crudo of lista) {
    const rol = ROLES.find((r) => r === crudo);
    if (!rol) throw new ErrorDeDominio("roles_invalidos");
    if (!roles.includes(rol)) roles.push(rol);
  }
  if (roles.length === 0) throw new ErrorDeDominio("roles_invalidos");
  return roles;
}

async function hashSeguro(hashear: (c: string) => Promise<string>, contrasena: string): Promise<string> {
  try {
    return await hashear(contrasena);
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("contrasena_no_disponible");
  }
}

type Resuelto = {
  repositorio: RepositorioInvitaciones;
  ahora: () => Date;
  token: () => string;
  hashear: (contrasena: string) => Promise<string>;
  verificar: (contrasena: string, hash: string) => Promise<boolean>;
  auditar: Auditar;
  segundoFactor: ContinuarConSegundoFactor;
};

function resolver(deps?: DependenciasInvitaciones): Resuelto {
  return {
    repositorio: deps?.repositorio ?? repositorioInvitacionesPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    token: deps?.token ?? tokenNuevo,
    hashear: deps?.hashear ?? hashearContrasena,
    verificar: deps?.verificar ?? verificarContrasena,
    auditar: deps?.auditar ?? registrarHechoAcceso,
    segundoFactor: deps?.segundoFactor ?? segundoFactorPendiente,
  };
}
