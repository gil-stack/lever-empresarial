import { randomUUID } from "node:crypto";

import { tieneConfiguracionNomina, validarConfiguracionNomina, type ConfiguracionNomina, type EntradaNomina } from "../../dominio/nomina";
import {
  estaDeBaja,
  hoyEnMexico,
  validarAltaPersona,
  validarBaja,
  validarCentro,
  type EntradaAltaPersona,
} from "../../dominio/personas";
import type { RolCliente } from "../../nucleo/capacidades";
import { exigir, exigirEmpresa, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { emitirEnTransaccion, emitirToken } from "../invitaciones/repositorio";
import { entregarInvitacion } from "../invitaciones/servicio";
import type { InvitacionEmitida, ResultadoDeEntrega } from "../invitaciones/tipos";
import { repositorioPg } from "./repositorio";
import type { DetallePersona, FiltrosPersonas, LecturaMaestro, RepositorioPersonas } from "./tipos";

type Emitir = typeof emitirEnTransaccion;
type Reemitir = typeof emitirToken;
type Entregar = (emitida: InvitacionEmitida, razonSocial: string | null) => Promise<ResultadoDeEntrega>;

export type DependenciasPersonas = {
  repositorio?: RepositorioPersonas;
  ahora?: () => Date;
  auditar?: Auditar;
  emitir?: Emitir;
  reemitir?: Reemitir;
  entregar?: Entregar;
};

export type AltaDePersona = {
  id: string;
  nombre: string;
  invitacion: "enviada" | "pendiente" | null;
  repetida?: boolean;
  clabeDuplicada?: boolean;
};

const FILTROS_INICIALES: FiltrosPersonas = { buscar: "", centroId: null, estado: "todos", pagina: 1 };

export async function leerMaestro(
  ctx: ContextoDeTenant | null | undefined,
  filtros: FiltrosPersonas = FILTROS_INICIALES,
  deps?: DependenciasPersonas,
): Promise<LecturaMaestro> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.maestro.ver")) throw new ErrorDeDominio("maestro_no_disponible");
  const listo = resolver(deps);
  return listo.repositorio.leer(conEmpresa, hoyEnMexico(listo.ahora()), filtros);
}

export async function leerDetallePersona(
  ctx: ContextoDeTenant | null | undefined,
  personaId: string,
  deps?: DependenciasPersonas,
): Promise<DetallePersona | null> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.maestro.ver")) throw new ErrorDeDominio("maestro_no_disponible");
  if (!uuidValido(personaId)) throw new ErrorDeDominio("persona_ausente");
  const listo = resolver(deps);
  return listo.repositorio.detalle(conEmpresa, hoyEnMexico(listo.ahora()), personaId);
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
  entrada: { nombre?: unknown; presupuesto?: unknown; esTesoreria?: unknown },
  deps?: DependenciasPersonas,
): Promise<{ id: string; nombre: string }> {
  const validado = validarCentro(entrada);
  if (!validado.ok) throw new ErrorDeDominio(validado.codigo);
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  const listo = resolver(deps);
  return listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    if (await tx.centroOcupado(validado.nombre)) throw new ErrorDeDominio("centro_duplicado");
    const id = randomUUID();
    await tx.insertarCentro({ id, ...validado });
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
      accion: "alta_centro_costo",
      identificador: id,
      cambio: { presupuesto_centavos: validado.presupuestoCentavos, es_tesoreria: validado.esTesoreria },
    });
    return { id, nombre: validado.nombre };
  });
}

export async function editarArea(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { centroId?: unknown; nombre?: unknown; presupuesto?: unknown; esTesoreria?: unknown },
  deps?: DependenciasPersonas,
): Promise<void> {
  const id = typeof entrada.centroId === "string" ? entrada.centroId.trim() : "";
  if (!uuidValido(id)) throw new ErrorDeDominio("centro_invalido");
  const validado = validarCentro(entrada);
  if (!validado.ok) throw new ErrorDeDominio(validado.codigo);
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  const listo = resolver(deps);
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const previo = await tx.centroPorId(id);
    if (!previo) throw new ErrorDeDominio("centro_invalido");
    if (await tx.centroOcupado(validado.nombre, id)) throw new ErrorDeDominio("centro_duplicado");
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
      accion: "editar_area",
      identificador: id,
      cambio: {
        presupuesto_anterior: previo.presupuestoCentavos,
        presupuesto_nuevo: validado.presupuestoCentavos,
      },
    });
    await tx.actualizarCentro({ id, ...validado });
  });
}

/** El alta administrativa, la nómina y la solicitud de tarjeta se confirman juntas. */
export async function darDeAltaPersona(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaAltaPersona & EntradaNomina,
  deps?: DependenciasPersonas,
): Promise<AltaDePersona> {
  const listo = resolver(deps);
  const hoy = hoyEnMexico(listo.ahora());
  const validada = validarAltaPersona(entrada, hoy);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const valor = validada.valor;
  let nomina: ConfiguracionNomina | null = null;
  if (tieneConfiguracionNomina(entrada)) {
    const validadaNomina = validarConfiguracionNomina(entrada, hoy, valor.altaEn);
    if (!validadaNomina.ok) throw new ErrorDeDominio(codigoDeNomina(validadaNomina.errores[0]?.campo));
    nomina = validadaNomina.valor;
  }
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  const actor = actorDeCliente(conEmpresa);

  const hecho = await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    if (valor.altaLlave) {
      const previa = await tx.empleadoPorLlave(valor.altaLlave);
      if (previa) return { ...previa, emitida: null, repetida: true, clabeDuplicada: false };
    }
    const centro = await tx.centroPorId(valor.centroId);
    if (!centro) throw new ErrorDeDominio("centro_invalido");
    if (valor.jefeId) await validarJefe(tx.jefePorId, valor.jefeId, hoy);

    let userIdPersona: string | null = null;
    let emitida: InvitacionEmitida | null = null;
    if (valor.acceso.tipo === "ya") {
      const miembro = await tx.miembroPorCorreo(valor.acceso.correo);
      if (!miembro || miembro.estado !== "activa") throw new ErrorDeDominio("persona_no_esta");
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
    const clabeDuplicada = valor.clabe ? await tx.clabeDuplicada(valor.clabe, id) : false;
    await listo.auditar(tx.consulta, actor, {
      accion: "alta_persona",
      identificador: id,
      cambio: { presupuesto_centavos: valor.presupuestoCentavos },
    });
    if (valor.bajaEn !== null) await listo.auditar(tx.consulta, actor, { accion: "baja_persona", identificador: id });
    const roles: readonly RolCliente[] = valor.acceso.tipo === "nueva"
      ? valor.acceso.roles
      : userIdPersona
        ? await tx.rolesDe(userIdPersona)
        : [];
    await auditarRolInicial(listo.auditar, tx.consulta, actor, userIdPersona, roles, valor.bajaEn, hoy);
    await tx.insertarEmpleado({
      id,
      nombre: valor.nombre,
      altaEn: valor.altaEn,
      bajaEn: valor.bajaEn,
      clabe: valor.clabe,
      presupuestoCentavos: valor.presupuestoCentavos,
      altaLlave: valor.altaLlave,
      jefeId: valor.jefeId,
      centroId: valor.centroId,
      userId: userIdPersona,
    });
    if (nomina) {
      await listo.auditar(tx.consulta, actor, { accion: "configurar_nomina", identificador: id });
      await tx.insertarNomina(id, nomina);
    }
    if (valor.destino === "tarjeta") {
      const tarjetaId = randomUUID();
      await listo.auditar(tx.consulta, actor, { accion: "solicitar_tarjeta", identificador: tarjetaId });
      await tx.solicitarTarjeta({ id: tarjetaId, employeeId: id, actorId: conEmpresa.persona.id });
    }
    if (userIdPersona && roles.includes("liberador") && valor.bajaEn && estaDeBaja(valor.bajaEn, hoy)) {
      await tx.quitarLiberador(userIdPersona);
    }
    return { id, nombre: valor.nombre, emitida, repetida: false, clabeDuplicada };
  });

  if (!hecho.emitida) return { id: hecho.id, nombre: hecho.nombre, invitacion: null, repetida: hecho.repetida, clabeDuplicada: hecho.clabeDuplicada };
  const entrega = await listo.entregar(hecho.emitida, conEmpresa.empresa.razonSocial);
  return { id: hecho.id, nombre: hecho.nombre, invitacion: entrega.entregada ? "enviada" : "pendiente", clabeDuplicada: hecho.clabeDuplicada };
}

export async function editarPersona(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaAltaPersona & { personaId?: unknown },
  deps?: DependenciasPersonas,
): Promise<void> {
  const personaId = typeof entrada.personaId === "string" ? entrada.personaId.trim() : "";
  if (!uuidValido(personaId)) throw new ErrorDeDominio("persona_ausente");
  const listo = resolver(deps);
  const hoy = hoyEnMexico(listo.ahora());
  const validada = validarAltaPersona({ ...entrada, acceso: "no", altaLlave: null }, hoy);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const valor = validada.valor;
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const previa = await tx.bloquearPersona(personaId);
    if (!previa) throw new ErrorDeDominio("persona_ausente");
    if (!await tx.centroPorId(valor.centroId)) throw new ErrorDeDominio("centro_invalido");
    if (valor.jefeId) {
      await validarJefe(tx.jefePorId, valor.jefeId, hoy);
      if (await tx.jefeCreaCiclo(personaId, valor.jefeId)) throw new ErrorDeDominio("jefe_ciclo");
    }
    const proximoPago = await tx.proximoPago(personaId);
    if (proximoPago && proximoPago < valor.altaEn) throw new ErrorDeDominio("alta_posterior_pago");
    await listo.auditar(tx.consulta, actorDeCliente(conEmpresa), {
      accion: "editar_persona",
      identificador: personaId,
      cambio: { presupuesto_nuevo: valor.presupuestoCentavos },
    });
    await tx.actualizarEmpleado({
      id: personaId,
      nombre: valor.nombre,
      altaEn: valor.altaEn,
      clabe: valor.clabe,
      presupuestoCentavos: valor.presupuestoCentavos,
      jefeId: valor.jefeId,
      centroId: valor.centroId,
    });
  });
}

export async function reenviarInvitacionPersona(
  ctx: ContextoDeTenant | null | undefined,
  personaId: string,
  deps?: DependenciasPersonas,
): Promise<"enviada" | "pendiente"> {
  if (!uuidValido(personaId)) throw new ErrorDeDominio("persona_ausente");
  const conEmpresa = exigir(ctx, "cliente.maestro.editar");
  const listo = resolver(deps);
  const actor = actorDeCliente(conEmpresa);
  const emitida = await listo.repositorio.conEmpresa(conEmpresa, async (tx) => {
    const persona = await tx.personaParaInvitacion(personaId);
    if (!persona) throw new ErrorDeDominio("persona_ausente");
    return listo.reemitir(tx.consulta, actor, {
      operadorId: conEmpresa.empresa.operadorId,
      companyId: conEmpresa.empresa.id,
      userId: persona.userId,
      nombre: persona.nombre,
      correo: persona.correo,
      roles: persona.roles,
      ahora: listo.ahora(),
    });
  });
  const entrega = await listo.entregar(emitida, conEmpresa.empresa.razonSocial);
  return entrega.entregada ? "enviada" : "pendiente";
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
    const efectiva = estaDeBaja(validada.bajaEn, hoy);
    if (efectiva && persona.userId && persona.roles.includes("liberador")) {
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
    if (efectiva) {
      if (await tx.nominaActiva(persona.id)) {
        await listo.auditar(tx.consulta, actor, { accion: "desactivar_nomina", identificador: persona.id });
        await tx.desactivarNomina(persona.id);
      }
      for (const tarjetaId of await tx.tarjetasPendientes(persona.id)) {
        await listo.auditar(tx.consulta, actor, { accion: "cancelar_tarjeta", identificador: tarjetaId });
        await tx.cancelarTarjeta(tarjetaId);
      }
      if (persona.userId) {
        await listo.auditar(tx.consulta, actor, { accion: "desprovisionar_persona", identificador: persona.id });
        if (persona.roles.includes("liberador")) await tx.quitarLiberador(persona.userId);
        await tx.desprovisionar(persona.userId);
      }
    }
    return { id: persona.id, bajaEn: validada.bajaEn };
  });
}

async function validarJefe(
  leer: (id: string) => Promise<{ bajaEn: string | null } | null>,
  jefeId: string,
  hoy: string,
): Promise<void> {
  const jefe = await leer(jefeId);
  if (!jefe) throw new ErrorDeDominio("jefe_invalido");
  if (estaDeBaja(jefe.bajaEn, hoy)) throw new ErrorDeDominio("jefe_de_baja");
}

async function auditarRolInicial(
  auditar: Auditar,
  consulta: Parameters<Auditar>[0],
  actor: Parameters<Auditar>[1],
  userId: string | null,
  roles: readonly RolCliente[],
  bajaEn: string | null,
  hoy: string,
): Promise<void> {
  if (!userId || !roles.includes("liberador")) return;
  await auditar(consulta, actor, {
    accion: bajaEn && estaDeBaja(bajaEn, hoy) ? "quitar_liberador" : "autorizar_liberador",
    identificador: userId,
    cambio: { rol: "liberador" },
  });
}

function codigoDeNomina(campo: string | undefined): string {
  return campo === "neto" ? "neto_invalido" : campo === "frecuencia" ? "frecuencia_invalida" : campo === "destino" ? "destino_invalido" : "primer_pago_invalido";
}

function uuidValido(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

function resolver(deps?: DependenciasPersonas): Required<DependenciasPersonas> {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    auditar: deps?.auditar ?? auditarPorDefecto,
    emitir: deps?.emitir ?? emitirEnTransaccion,
    reemitir: deps?.reemitir ?? emitirToken,
    entregar: deps?.entregar ?? ((emitida, razonSocial) => entregarInvitacion(emitida, razonSocial)),
  };
}
