import { randomUUID } from "node:crypto";

import { estaDeBaja, hoyEnMexico, validarAltaPersona, validarBaja, validarCentro } from "../../dominio/personas";
import type { RolCliente } from "../../nucleo/capacidades";
import { exigir, exigirEmpresa, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { emitirEnTransaccion } from "../invitaciones/repositorio";
import { entregarInvitacion } from "../invitaciones/servicio";
import type { InvitacionEmitida, ResultadoDeEntrega } from "../invitaciones/tipos";
import { repositorioPg } from "./repositorio";
import type { LecturaMaestro, RepositorioPersonas } from "./tipos";

type Emitir = typeof emitirEnTransaccion;
type Entregar = (emitida: InvitacionEmitida, razonSocial: string | null) => Promise<ResultadoDeEntrega>;

export type DependenciasPersonas = {
  repositorio?: RepositorioPersonas;
  ahora?: () => Date;
  auditar?: Auditar;
  emitir?: Emitir;
  entregar?: Entregar;
};

export type AltaDePersona = {
  id: string;
  nombre: string;
  /** enviada: el correo salió. pendiente: quedó emitida y no salió. */
  invitacion: "enviada" | "pendiente" | null;
};

export async function leerMaestro(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasPersonas,
): Promise<LecturaMaestro> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.maestro.ver")) throw new ErrorDeDominio("maestro_no_disponible");
  const listo = resolver(deps);
  return listo.repositorio.leer(conEmpresa, hoyEnMexico(listo.ahora()));
}

export async function resumenParaConsola(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasPersonas,
): Promise<{ nombres: string[] } | null> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.maestro.ver")) return null;
  const listo = resolver(deps);
  return listo.repositorio.resumen(conEmpresa, hoyEnMexico(listo.ahora()));
}

export async function nombrarCentro(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { nombre?: unknown },
  deps?: DependenciasPersonas,
): Promise<{ id: string; nombre: string }> {
  const validado = validarCentro(entrada);
  if (!validado.ok) throw new ErrorDeDominio(validado.codigo);
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  const listo = resolver(deps);
  return listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    if (await tx.centroOcupado(validado.nombre)) throw new ErrorDeDominio("centro_duplicado");
    const id = randomUUID();
    await tx.insertarCentro({ id, nombre: validado.nombre });
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), { accion: "alta_centro_costo", identificador: id });
    return { id, nombre: validado.nombre };
  });
}

/**
 * Con acceso nuevo, la persona recibe una invitación y fija su propia
 * contraseña. Si su correo ya entra a otra empresa (una contadora con dos
 * clientes), se le invita a esta con la misma identidad.
 */
export async function darDeAltaPersona(
  ctx: ContextoDeTenant | null | undefined,
  entrada: {
    nombre?: unknown;
    alta?: unknown;
    baja?: unknown;
    centroId?: unknown;
    jefeId?: unknown;
    clabe?: unknown;
    acceso?: unknown;
    correo?: unknown;
    rol?: unknown;
  },
  deps?: DependenciasPersonas,
): Promise<AltaDePersona> {
  const listo = resolver(deps);
  const hoy = hoyEnMexico(listo.ahora());
  const validada = validarAltaPersona(entrada, hoy);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const valor = validada.valor;
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  const actor = actorDeCliente(conEmpresa);

  const hecho = await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const centro = await tx.centroPorId(valor.centroId);
    if (!centro) throw new ErrorDeDominio("centro_invalido");
    if (valor.jefeId) {
      const jefe = await tx.jefePorId(valor.jefeId);
      if (!jefe) throw new ErrorDeDominio("jefe_invalido");
      if (estaDeBaja(jefe.bajaEn, hoy)) throw new ErrorDeDominio("jefe_de_baja");
    }

    let userIdPersona: string | null = null;
    let emitida: InvitacionEmitida | null = null;
    if (valor.acceso.tipo === "ya") {
      const miembro = await tx.miembroPorCorreo(valor.acceso.correo);
      if (!miembro) throw new ErrorDeDominio("persona_no_esta");
      if (miembro.tieneEmpleado) throw new ErrorDeDominio("persona_repetida");
      userIdPersona = miembro.id;
    } else if (valor.acceso.tipo === "nueva") {
      if (await tx.miembroPorCorreo(valor.acceso.correo)) throw new ErrorDeDominio("correo_ya_entra");
      emitida = await listo.emitir(tx.consulta, actor, {
        operadorId: conEmpresa.empresa.operadorId,
        nombre: valor.nombre,
        correo: valor.acceso.correo,
        destino: { tipo: "empresa", companyId: conEmpresa.empresa.id, roles: valor.acceso.roles },
        ahora: listo.ahora(),
      });
      userIdPersona = emitida.userId;
    }

    const id = randomUUID();
    if (valor.jefeId === id) throw new ErrorDeDominio("jefe_invalido");
    await listo.auditar(tx.consulta, actor, { accion: "alta_persona", identificador: id });
    if (valor.bajaEn !== null) {
      await listo.auditar(tx.consulta, actor, { accion: "baja_persona", identificador: id });
    }
    const roles: readonly RolCliente[] =
      valor.acceso.tipo === "nueva" ? valor.acceso.roles : userIdPersona ? await tx.rolesDe(userIdPersona) : [];
    if (userIdPersona && roles.includes("liberador")) {
      if (valor.bajaEn && estaDeBaja(valor.bajaEn, hoy)) {
        await listo.auditar(tx.consulta, actor, {
          accion: "quitar_liberador",
          identificador: userIdPersona,
          cambio: { rol: "liberador" },
        });
      } else if (valor.acceso.tipo === "nueva") {
        await listo.auditar(tx.consulta, actor, {
          accion: "autorizar_liberador",
          identificador: userIdPersona,
          cambio: { rol: "liberador" },
        });
      }
    }
    await tx.insertarEmpleado({
      id,
      nombre: valor.nombre,
      altaEn: valor.altaEn,
      bajaEn: valor.bajaEn,
      clabe: valor.clabe,
      jefeId: valor.jefeId,
      centroId: valor.centroId,
      userId: userIdPersona,
    });
    if (userIdPersona && roles.includes("liberador") && valor.bajaEn && estaDeBaja(valor.bajaEn, hoy)) {
      await tx.quitarLiberador(userIdPersona);
    }
    return { id, nombre: valor.nombre, emitida };
  });

  if (!hecho.emitida) return { id: hecho.id, nombre: hecho.nombre, invitacion: null };
  const entrega = await listo.entregar(hecho.emitida, conEmpresa.empresa.razonSocial);
  return { id: hecho.id, nombre: hecho.nombre, invitacion: entrega.entregada ? "enviada" : "pendiente" };
}

export async function registrarBaja(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { personaId?: unknown; baja?: unknown },
  deps?: DependenciasPersonas,
): Promise<{ id: string; bajaEn: string }> {
  const validada = validarBaja(entrada);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  const actor = actorDeCliente(conEmpresa);
  const listo = resolver(deps);
  const hoy = hoyEnMexico(listo.ahora());
  return listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const persona = await tx.bloquearPersona(validada.personaId);
    if (!persona) throw new ErrorDeDominio("persona_ausente");
    if (validada.bajaEn < persona.altaEn) throw new ErrorDeDominio("baja_anterior");
    const quitaLiberador = estaDeBaja(validada.bajaEn, hoy) && persona.roles.includes("liberador") && persona.userId;
    if (quitaLiberador && persona.userId) {
      await listo.auditar(tx.consulta, actor, {
        accion: "quitar_liberador",
        identificador: persona.userId,
        cambio: { rol: "liberador" },
      });
    }
    if (persona.bajaEn !== validada.bajaEn) {
      await listo.auditar(tx.consulta, actor, { accion: "baja_persona", identificador: persona.id });
      await tx.escribirBaja(persona.id, validada.bajaEn);
    }
    if (quitaLiberador && persona.userId) await tx.quitarLiberador(persona.userId);
    return { id: persona.id, bajaEn: validada.bajaEn };
  });
}

function resolver(deps?: DependenciasPersonas): Required<DependenciasPersonas> {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    auditar: deps?.auditar ?? auditarPorDefecto,
    emitir: deps?.emitir ?? emitirEnTransaccion,
    entregar: deps?.entregar ?? ((emitida, razonSocial) => entregarInvitacion(emitida, razonSocial)),
  };
}
