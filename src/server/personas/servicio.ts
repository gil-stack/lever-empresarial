import { randomUUID } from "node:crypto";

import {
  estaDeBaja,
  hoyEnMexico,
  puedeEditarMaestro,
  puedeVerMaestro,
  validarAltaPersona,
  validarBaja,
  validarCentro,
} from "../../dominio/personas";
import type { Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { hashearContrasena } from "../session/hash";
import type { Sesion } from "../session/tipos";
import { validarCuenta } from "../session/validar";
import { registrarHechoMaestro, type HechoMaestro } from "./auditar";
import { repositorioPg } from "./repositorio";
import type { LecturaMaestro, RepositorioPersonas } from "./tipos";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Hashear = (contrasena: string) => Promise<string>;
type Auditar = (evento: HechoMaestro, consulta: Consulta) => Promise<void>;

export type DependenciasPersonas = {
  repositorio?: RepositorioPersonas;
  ahora?: () => Date;
  hashear?: Hashear;
  auditar?: Auditar;
};

export function usuarioDeSesion(sesion: Sesion | null | undefined): string {
  const id = sesion?.usuario?.id;
  if (typeof id !== "string" || !UUID.test(id)) throw new ErrorDeDominio("sesion_ausente");
  return id;
}

export async function leerMaestro(
  sesion: Sesion | null | undefined,
  deps?: DependenciasPersonas,
): Promise<LecturaMaestro> {
  const userId = usuarioDeSesion(sesion);
  const repo = resolver(deps).repositorio;
  const puerta = await repo.puerta(userId);
  if (!puerta) throw new ErrorDeDominio("sin_empresa");
  if (!puedeVerMaestro(puerta.rol)) throw new ErrorDeDominio("maestro_no_disponible");
  const lectura = await repo.leer(userId, hoyEnMexico(resolver(deps).ahora()));
  if (!lectura) throw new ErrorDeDominio("sin_empresa");
  if (!puedeVerMaestro(lectura.rol)) throw new ErrorDeDominio("maestro_no_disponible");
  return lectura;
}

export async function resumenParaConsola(
  sesion: Sesion | null | undefined,
  deps?: DependenciasPersonas,
): Promise<{ nombres: string[] } | null> {
  const userId = usuarioDeSesion(sesion);
  const listo = resolver(deps);
  const puerta = await listo.repositorio.puerta(userId);
  if (!puerta || !puedeVerMaestro(puerta.rol)) return null;
  return listo.repositorio.resumen(userId, hoyEnMexico(listo.ahora()));
}

export async function nombrarCentro(
  sesion: Sesion | null | undefined,
  entrada: { nombre?: unknown },
  deps?: DependenciasPersonas,
): Promise<{ id: string; nombre: string }> {
  const userId = usuarioDeSesion(sesion);
  const validado = validarCentro(entrada);
  if (!validado.ok) throw new ErrorDeDominio(validado.codigo);
  const listo = resolver(deps);
  const ahora = listo.ahora();
  try {
    return await listo.repositorio.conEmpresa(userId, async (ctx) => {
      if (!puedeEditarMaestro(ctx.rol)) throw new ErrorDeDominio("sin_permiso");
      if (await ctx.centroOcupado(validado.nombre)) throw new ErrorDeDominio("centro_duplicado");
      const id = randomUUID();
      await ctx.insertarCentro({ id, nombre: validado.nombre });
      await auditar(listo.auditar, ctx.consulta, {
        companyId: ctx.companyId,
        actorId: userId,
        accion: "alta_centro_costo",
        entidad: "cost_centers",
        identificador: id,
        ocurridoEn: ahora,
      });
      return { id, nombre: validado.nombre };
    });
  } catch (error) {
    throw traducirUnico(error);
  }
}

export async function darDeAltaPersona(
  sesion: Sesion | null | undefined,
  entrada: {
    nombre?: unknown;
    alta?: unknown;
    baja?: unknown;
    centroId?: unknown;
    jefeId?: unknown;
    clabe?: unknown;
    acceso?: unknown;
    correo?: unknown;
    contrasena?: unknown;
    rol?: unknown;
  },
  deps?: DependenciasPersonas,
): Promise<{ id: string; nombre: string }> {
  const userId = usuarioDeSesion(sesion);
  const listo = resolver(deps);
  const hoy = hoyEnMexico(listo.ahora());
  const validada = validarAltaPersona(entrada, hoy);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const valor = validada.valor;
  const passwordHash =
    valor.acceso.tipo === "nueva"
      ? await hashDeAcceso(valor.nombre, valor.acceso.correo, valor.acceso.contrasena, listo.hashear)
      : null;

  try {
    return await listo.repositorio.conEmpresa(userId, async (ctx) => {
      if (!puedeEditarMaestro(ctx.rol)) throw new ErrorDeDominio("sin_permiso");
      const centro = await ctx.centroPorId(valor.centroId);
      if (!centro) throw new ErrorDeDominio("centro_invalido");
      if (valor.jefeId) {
        const jefe = await ctx.jefePorId(valor.jefeId);
        if (!jefe) throw new ErrorDeDominio("jefe_invalido");
        if (estaDeBaja(jefe.bajaEn, hoy)) throw new ErrorDeDominio("jefe_de_baja");
      }

      let userIdPersona: string | null = null;
      if (valor.acceso.tipo === "ya") {
        const existente = await ctx.usuarioPorCorreo(valor.acceso.correo);
        if (!existente || existente.companyId !== ctx.companyId) {
          throw new ErrorDeDominio("persona_no_esta");
        }
        if (existente.tieneEmpleado) throw new ErrorDeDominio("persona_repetida");
        userIdPersona = existente.id;
      } else if (valor.acceso.tipo === "nueva") {
        const existente = await ctx.usuarioPorCorreo(valor.acceso.correo);
        if (existente?.companyId === ctx.companyId) throw new ErrorDeDominio("correo_ya_entra");
        if (existente) throw new ErrorDeDominio("correo_no_disponible");
        if (!passwordHash) throw new ErrorDeDominio("contrasena_invalida");
        userIdPersona = randomUUID();
        await ctx.insertarUsuario({
          id: userIdPersona,
          nombre: valor.nombre,
          correo: valor.acceso.correo,
          passwordHash,
        });
        await ctx.insertarMembresia(userIdPersona, valor.acceso.rol);
      }

      const rolCuenta =
        valor.acceso.tipo === "nueva"
          ? valor.acceso.rol
          : valor.acceso.tipo === "ya" && userIdPersona
            ? await ctx.rolDeUsuario(userIdPersona)
            : null;

      const id = randomUUID();
      if (valor.jefeId === id) throw new ErrorDeDominio("jefe_invalido");
      await ctx.insertarEmpleado({
        id,
        nombre: valor.nombre,
        altaEn: valor.altaEn,
        bajaEn: valor.bajaEn,
        clabe: valor.clabe,
        jefeId: valor.jefeId,
        centroId: valor.centroId,
        userId: userIdPersona,
      });
      const ocurridoEn = listo.ahora();
      await auditar(listo.auditar, ctx.consulta, {
        companyId: ctx.companyId,
        actorId: userId,
        accion: "alta_persona",
        entidad: "employees",
        identificador: id,
        ocurridoEn,
      });
      if (valor.bajaEn !== null) {
        await auditar(listo.auditar, ctx.consulta, {
          companyId: ctx.companyId,
          actorId: userId,
          accion: "baja_persona",
          entidad: "employees",
          identificador: id,
          ocurridoEn,
        });
      }
      if (userIdPersona && rolCuenta === "liberador") {
        if (valor.bajaEn && estaDeBaja(valor.bajaEn, hoy)) {
          await auditar(listo.auditar, ctx.consulta, {
            companyId: ctx.companyId,
            actorId: userId,
            accion: "quitar_liberador",
            entidad: "memberships",
            identificador: userIdPersona,
            ocurridoEn,
          });
          await ctx.quitarLiberador(userIdPersona);
        } else if (valor.acceso.tipo === "nueva") {
          await auditar(listo.auditar, ctx.consulta, {
            companyId: ctx.companyId,
            actorId: userId,
            accion: "autorizar_liberador",
            entidad: "memberships",
            identificador: userIdPersona,
            ocurridoEn,
          });
        }
      }
      return { id, nombre: valor.nombre };
    });
  } catch (error) {
    throw traducirUnico(error);
  }
}

export async function registrarBaja(
  sesion: Sesion | null | undefined,
  entrada: { personaId?: unknown; baja?: unknown },
  deps?: DependenciasPersonas,
): Promise<{ id: string; bajaEn: string }> {
  const userId = usuarioDeSesion(sesion);
  const validada = validarBaja(entrada);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const listo = resolver(deps);
  const hoy = hoyEnMexico(listo.ahora());
  return listo.repositorio.conEmpresa(userId, async (ctx) => {
    if (!puedeEditarMaestro(ctx.rol)) throw new ErrorDeDominio("sin_permiso");
    const persona = await ctx.bloquearPersona(validada.personaId);
    if (!persona) throw new ErrorDeDominio("persona_ausente");
    if (validada.bajaEn < persona.altaEn) throw new ErrorDeDominio("baja_anterior");
    const ocurridoEn = listo.ahora();
    if (persona.bajaEn !== validada.bajaEn) {
      await ctx.escribirBaja(persona.id, validada.bajaEn);
      await auditar(listo.auditar, ctx.consulta, {
        companyId: ctx.companyId,
        actorId: userId,
        accion: "baja_persona",
        entidad: "employees",
        identificador: persona.id,
        ocurridoEn,
      });
    }
    if (estaDeBaja(validada.bajaEn, hoy) && persona.rol === "liberador" && persona.userId) {
      await auditar(listo.auditar, ctx.consulta, {
        companyId: ctx.companyId,
        actorId: userId,
        accion: "quitar_liberador",
        entidad: "memberships",
        identificador: persona.userId,
        ocurridoEn,
      });
      await ctx.quitarLiberador(persona.userId);
    }
    return { id: persona.id, bajaEn: validada.bajaEn };
  });
}

async function hashDeAcceso(
  nombre: string,
  correo: string,
  contrasena: string,
  hashear: Hashear,
): Promise<string> {
  const cuenta = validarCuenta({ nombre, correo, contrasena });
  if (!cuenta.ok) throw new ErrorDeDominio(cuenta.codigo);
  try {
    return await hashear(cuenta.valor.contrasena);
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("contrasena_no_disponible");
  }
}

async function auditar(fn: Auditar, consulta: Consulta, evento: HechoMaestro): Promise<void> {
  try {
    await fn(evento, consultaSinCierre(consulta));
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    if (error instanceof Error && error.message.startsWith("Auditoría rechazada:")) {
      throw new ErrorDeDominio("auditoria_no_disponible");
    }
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
}

function consultaSinCierre(consulta: Consulta): Consulta {
  return {
    async query(sql, params) {
      const verbo = (sql.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/;$/, "");
      if (verbo === "begin" || verbo === "commit" || verbo === "rollback" || verbo === "start") {
        throw new ErrorDeDominio("auditoria_no_disponible");
      }
      return consulta.query(sql, params);
    },
  };
}

function traducirUnico(error: unknown): Error {
  if (error instanceof ErrorDeDominio && error.codigo === "correo_duplicado") {
    return new ErrorDeDominio("correo_no_disponible");
  }
  if (error instanceof Error) return error;
  return new ErrorDeDominio("base_no_disponible");
}

function resolver(deps?: DependenciasPersonas): {
  repositorio: RepositorioPersonas;
  ahora: () => Date;
  hashear: Hashear;
  auditar: Auditar;
} {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    hashear: deps?.hashear ?? hashearContrasena,
    auditar: deps?.auditar ?? registrarHechoMaestro,
  };
}
