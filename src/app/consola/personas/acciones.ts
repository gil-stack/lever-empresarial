"use server";

import { revalidatePath } from "next/cache";

import {
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
import { contextoDeAccion, errorConSecreto } from "@/server/entrada";
import { darDeAltaPersona, nombrarCentro, registrarBaja } from "@/server/personas";
import { cambiarAccesoFinanzas, rechazoDeFinanzas } from "@/server/roles";
import { ErrorDeDominio } from "@/server/session";

const LISTO_CENTRO = "El centro de costo quedó nombrado.";
const LISTO_PERSONA = "La persona quedó en el maestro. No se dispersó dinero.";
const LISTO_INVITADA = "La persona quedó en el maestro y su invitación salió a su correo. No se dispersó dinero.";
const LISTO_PENDIENTE =
  "La persona quedó en el maestro. Su invitación quedó emitida, pero el correo todavía no sale. No se dispersó dinero.";
const LISTO_BAJA = "La fecha de baja quedó en el maestro. No se dispersó dinero.";

export async function enviarCentro(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const validado = validarCentro({ nombre: formData.get("centroNombre") });
  if (!validado.ok) {
    const campo = MENSAJE_CAMPO[validado.codigo];
    return { tipo: "invalido", errores: campo ? [campo] : [] };
  }
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  try {
    await nombrarCentro(sesion, { nombre: validado.nombre });
  } catch (error) {
    return traducir(error);
  }
  refrescar();
  return { tipo: "listo", mensaje: LISTO_CENTRO };
}

export async function enviarPersona(_previo: EstadoMaestro, formData: FormData): Promise<EstadoMaestro> {
  const hoy = hoyEnMexico(new Date());
  const entrada = leerPersona(formData);
  const errores = erroresDeAltaPersona(entrada, hoy);
  if (errores.length > 0) return { tipo: "invalido", errores };
  const sesion = await leerSesion();
  if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
  let invitacion: "enviada" | "pendiente" | null;
  try {
    invitacion = (await darDeAltaPersona(sesion, entrada)).invitacion;
  } catch (error) {
    return traducir(error);
  }
  refrescar();
  if (invitacion === "enviada") return { tipo: "listo", mensaje: LISTO_INVITADA };
  if (invitacion === "pendiente") return { tipo: "listo", mensaje: LISTO_PENDIENTE };
  return { tipo: "listo", mensaje: LISTO_PERSONA };
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
      return {
        tipo: "invalido",
        errores: [{ campo: "baja", mensaje: "Esa fecha no existe." }],
      };
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
  return { tipo: "listo", mensaje: LISTO_BAJA };
}

function leerPersona(formData: FormData): EntradaAltaPersona {
  return {
    nombre: formData.get("nombre"),
    alta: formData.get("alta"),
    baja: formData.get("baja"),
    centroId: formData.get("centroId"),
    jefeId: formData.get("jefeId"),
    clabe: formData.get("clabe"),
    acceso: formData.get("acceso"),
    correo: formData.get("correo"),
    rol: formData.getAll("rol"),
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
  if (
    error.codigo === "base_no_disponible" ||
    error.codigo === "base_no_configurada" ||
    error.codigo === "auditoria_no_disponible"
  ) {
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
  revalidatePath("/consola/pendientes");
  revalidatePath("/consola");
}

