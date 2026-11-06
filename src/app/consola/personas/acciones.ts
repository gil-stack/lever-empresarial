"use server";

import { revalidatePath } from "next/cache";

import { erroresDeConfiguracionNomina } from "@/dominio/nomina";
import {
  altaConNomina,
  erroresDeAltaPersona,
  hoyEnMexico,
  MENSAJE_CAMPO,
  MENSAJE_RECHAZO,
  ordenarErroresPersona,
  validarBaja,
  validarCentro,
  type CampoPersona,
  type CodigoRechazoPersona,
  type EntradaAltaPersona,
  type EstadoFinanzas,
  type EstadoMaestro,
} from "@/dominio/personas";
import { contextoDeAccion, errorConSecreto, sesionSegura } from "@/server/entrada";
import { configurarNomina, prepararNomina } from "@/server/nomina";
import {
  cambiarClabeNomina,
  cancelarBaja,
  darDeAltaPersona,
  editarArea,
  editarPersona,
  nombrarCentro,
  reenviarInvitacionPersona,
  registrarBaja,
} from "@/server/personas";
import { cambiarAccesoFinanzas, rechazoDeFinanzas } from "@/server/roles";
import { ErrorDeDominio } from "@/server/session";

export async function enviarCentro(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const entrada = {
    nombre: formData.get("centroNombre"),
    presupuesto: formData.get("centroPresupuesto"),
    esTesoreria: formData.get("esTesoreria") === "si",
  };
  const validado = validarCentro(entrada);
  if (!validado.ok) {
    const campo = MENSAJE_CAMPO[validado.codigo];
    return { tipo: "invalido", errores: campo ? [campo] : [] };
  }
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  const centroId = formData.get("centroId");
  try {
    if (typeof centroId === "string" && centroId) {
      await editarArea(sesion, { centroId, ...entrada });
    } else {
      await nombrarCentro(sesion, entrada);
    }
  } catch (error) {
    return traducir(error);
  }
  refrescar();
  return { tipo: "listo", mensaje: centroId ? "El área y su presupuesto quedaron actualizados." : "El área quedó creada con su presupuesto." };
}

export async function enviarPersona(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const hoy = hoyEnMexico(new Date());
  const entrada = leerPersona(formData);
  const errores = erroresDeAltaPersona(entrada, hoy);
  if (altaConNomina(entrada)) {
    const alta = typeof entrada.alta === "string" ? entrada.alta : "";
    errores.push(...erroresDeConfiguracionNomina(entrada, hoy, alta));
  }
  if (errores.length > 0) return { tipo: "invalido", errores: ordenarErroresPersona(errores) };
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  try {
    const creada = await darDeAltaPersona(sesion, entrada);
    refrescar();
    const acceso = creada.invitacion === "enviada"
      ? " La invitación salió a su correo."
      : creada.invitacion === "pendiente"
        ? " La invitación quedó pendiente de correo; puedes reenviarla desde su expediente."
        : "";
    const duplicada = creada.clabeDuplicada ? " Revisa: la CLABE también aparece en otra persona." : "";
    const queda = altaConNomina(entrada) ? "con su presupuesto y nómina" : "sin nómina, solo con su ficha y acceso";
    const mensaje = creada.repetida
      ? "El alta ya estaba registrada; el reintento no creó otra persona."
      : `La persona quedó registrada ${queda}.${acceso}${duplicada}`;
    return { tipo: "listo", mensaje, id: creada.id };
  } catch (error) {
    return traducir(error);
  }
}

export async function enviarEdicionPersona(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const hoy = hoyEnMexico(new Date());
  const entrada = { ...leerPersona(formData), personaId: formData.get("personaId") };
  const errores = erroresDeAltaPersona(entrada, hoy);
  if (errores.length > 0) return { tipo: "invalido", errores };
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  try {
    await editarPersona(sesion, entrada);
  } catch (error) {
    return traducir(error);
  }
  refrescar();
  return { tipo: "listo", mensaje: "Los datos laborales y el presupuesto quedaron actualizados." };
}

export async function enviarNomina(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  const entrada = {
    personaId: formData.get("personaId"),
    neto: formData.get("neto"),
    frecuencia: formData.get("frecuencia"),
    primerPago: formData.get("primerPago"),
    destino: formData.get("destino"),
  };
  const alta = String(formData.get("alta") ?? "");
  const pagoAnterior = String(formData.get("pagoAnterior") ?? "") || undefined;
  const errores = erroresDeConfiguracionNomina(entrada, hoyEnMexico(new Date()), alta, pagoAnterior);
  if (errores.length > 0) return { tipo: "invalido", errores };
  try {
    await configurarNomina(sesion, entrada);
  } catch (error) {
    return traducir(error);
  }
  refrescar();
  return { tipo: "listo", mensaje: "La nómina quedó programada." };
}

export async function enviarPreparacionNomina(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  try {
    const preparada = await prepararNomina(sesion, formData.get("fechaPago"));
    refrescar();
    return {
      tipo: "listo",
      id: preparada.id,
      mensaje: preparada.repetida ? "El lote ya estaba preparado; no se duplicó." : "El lote quedó preparado para revisión.",
    };
  } catch (error) {
    return traducir(error);
  }
}

export async function enviarClabeNomina(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const personaId = formData.get("personaId");
  const clabe = formData.get("clabe");
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  try {
    const cambio = await cambiarClabeNomina(sesion, await sesionSegura(), { personaId, clabe });
    refrescar();
    const aviso = cambio.aviso === "enviado"
      ? " Le avisamos por correo a la persona."
      : cambio.aviso === "no_enviado"
        ? " El correo de aviso no salió; avísale tú. Quedó asentado en la bitácora."
        : "";
    const que = cambio.tipo === "cambiada" ? "La CLABE de nómina cambió y la anterior quedó en el historial." : "La CLABE de nómina quedó registrada.";
    return { tipo: "listo", mensaje: `${que}${aviso}` };
  } catch (error) {
    return traducir(error);
  }
}

export async function enviarCancelacionBaja(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  try {
    await cancelarBaja(sesion, { personaId: formData.get("personaId") });
  } catch (error) {
    return traducir(error);
  }
  refrescar();
  return { tipo: "listo", mensaje: "La baja programada quedó cancelada. La persona sigue vigente." };
}

export async function enviarReenvioInvitacion(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  const personaId = String(formData.get("personaId") ?? "");
  try {
    const resultado = await reenviarInvitacionPersona(sesion, personaId);
    refrescar();
    return {
      tipo: "listo",
      mensaje: resultado === "enviada" ? "La nueva invitación salió a su correo." : "La invitación quedó renovada, pero el correo sigue pendiente.",
    };
  } catch (error) {
    return traducir(error);
  }
}

export async function enviarFinanzas(_previo: EstadoFinanzas, formData: FormData): Promise<EstadoFinanzas> {
  const entrada = { userId: formData.get("userId"), verFinanzas: formData.get("verFinanzas") };
  try {
    const estado = await cambiarAccesoFinanzas(await leerSesion(), entrada);
    if (estado.tipo === "listo") refrescar();
    return estado;
  } catch (error) {
    if (errorConSecreto(error)) return rechazoDeFinanzas("libro", entrada.verFinanzas === "si");
    throw error;
  }
}

export async function enviarBaja(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const validada = validarBaja({
    personaId: formData.get("personaId"),
    baja: formData.get("baja"),
  });
  if (!validada.ok) {
    if (validada.codigo === "fecha_invalida") {
      return { tipo: "invalido", errores: [{ campo: "baja", mensaje: "Esa fecha no existe." }] };
    }
    return { tipo: "rechazado", codigo: "persona_ausente" };
  }
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  try {
    await registrarBaja(sesion, { personaId: validada.personaId, baja: validada.bajaEn });
  } catch (error) {
    return traducir(error, "baja");
  }
  refrescar();
  return { tipo: "listo", mensaje: "La baja quedó registrada. La nómina y los accesos efectivos se actualizaron." };
}

function leerPersona(formData: FormData): EntradaAltaPersona & {
  neto: FormDataEntryValue | null;
  frecuencia: FormDataEntryValue | null;
  primerPago: FormDataEntryValue | null;
} {
  return {
    nomina: formData.get("nomina"),
    nombre: formData.get("nombre"),
    alta: formData.get("alta"),
    baja: formData.get("baja") ?? "",
    centroId: formData.get("centroId"),
    jefeId: formData.get("jefeId"),
    presupuesto: formData.get("presupuesto") ?? "",
    altaLlave: formData.get("altaLlave"),
    destino: formData.get("destino"),
    clabe: formData.get("clabe") ?? "",
    acceso: formData.get("acceso") ?? "no",
    correo: formData.get("correo") ?? "",
    rol: formData.getAll("rol"),
    neto: formData.get("neto"),
    frecuencia: formData.get("frecuencia"),
    primerPago: formData.get("primerPago"),
  };
}

function leerSesion() {
  return contextoDeAccion();
}

function traducir(error: unknown, campoFecha: CampoPersona = "alta"): EstadoMaestro {
  if (!(error instanceof ErrorDeDominio)) {
    if (errorConSecreto(error)) return { tipo: "rechazado", codigo: "libro" };
    throw error;
  }
  if (error.codigo === "sesion_ausente" || error.codigo === "usuario_ausente") {
    return { tipo: "rechazado", codigo: "sesion" };
  }
  if (error.codigo === "auditoria_no_disponible") return { tipo: "rechazado", codigo: "auditoria" };
  if (["base_no_disponible", "base_no_configurada"].includes(error.codigo)) {
    return { tipo: "rechazado", codigo: "libro" };
  }
  const plantilla = MENSAJE_CAMPO[error.codigo];
  if (plantilla) {
    const campo = error.codigo === "fecha_invalida" ? campoFecha : plantilla.campo;
    return { tipo: "invalido", errores: ordenarErroresPersona([{ ...plantilla, campo }]) };
  }
  if (esRechazo(error.codigo)) return { tipo: "rechazado", codigo: error.codigo };
  return { tipo: "rechazado", codigo: "libro" };
}

function esRechazo(codigo: string): codigo is CodigoRechazoPersona {
  return Object.hasOwn(MENSAJE_RECHAZO, codigo);
}

function refrescar(): void {
  revalidatePath("/consola/personas");
  revalidatePath("/consola/personas/areas");
  revalidatePath("/consola/personas/nomina");
  revalidatePath("/consola/pendientes");
  revalidatePath("/consola");
}
