"use server";

import { refresh, revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { rechazado, type EstadoDelFormulario } from "@/app/operacion/rechazo";
import { fijarCookiesDeSesion, sesionSegura } from "@/server/entrada";
import {
  asignarAlerta,
  cerrarAlerta,
  crearAlerta,
  decidirActivacion,
  decidirCambioDeSuspension,
  decidirComision,
  exigirContextoOperacion,
  invitarPrimerAdministrador,
  darDeAltaClienteDePrueba,
  archivarClienteDePrueba,
  registrarProspecto,
  solicitarActivacion,
  solicitarComision,
  actualizarPlan,
  asignarPlan,
} from "@/server/operacion";
import { NOMBRE_COOKIE_ENTRADA_OPERACION, NOMBRE_COOKIE_PORTAL_OPERACION } from "@/server/operacion/acceso";
import { cerrarSesion, ErrorDeDominio } from "@/server/session";
import { NOMBRE_COOKIE, NOMBRE_COOKIE_PARCIAL } from "@/server/session/cookie";

export async function registrarProspectoAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  let id: string;
  try {
    id = await registrarProspecto(ctx, {
      rfc: String(formData.get("rfc") ?? ""),
      razonSocial: String(formData.get("razonSocial") ?? ""),
      codigoPostal: String(formData.get("codigoPostal") ?? ""),
      regimen: String(formData.get("regimen") ?? ""),
      usoCfdi: String(formData.get("usoCfdi") ?? ""),
      contactoNombre: formData.get("contactoNombre"),
      contactoCorreo: formData.get("contactoCorreo"),
    });
  } catch (error) {
    return rechazado(previo, error, formData, ["razonSocial", "rfc", "codigoPostal", "regimen", "usoCfdi", "contactoNombre", "contactoCorreo"]);
  }
  actualizar();
  redirect(`/operacion/clientes/${id}?aviso=prospecto_registrado`);
}

/**
 * Alta rápida de un cliente de prueba: queda activo, con su administrador invitado y, si el procesador responde, dado de
 * alta en tarjetas. El resultado se pinta en la misma pantalla porque el enlace de la invitación no va en la dirección.
 */
export async function altaRapidaAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const razonSocial = String(formData.get("razonSocial") ?? "");
  let resultado: Awaited<ReturnType<typeof darDeAltaClienteDePrueba>>;
  try {
    resultado = await darDeAltaClienteDePrueba(ctx, {
      razonSocial,
      rfc: formData.get("rfc"),
      nombre: formData.get("nombre"),
      correo: formData.get("correo"),
    });
  } catch (error) {
    return rechazado(previo, error, formData, ["razonSocial", "rfc", "nombre", "correo"]);
  }
  actualizar();
  refresh();
  return {
    aviso: "cliente_prueba_creado",
    valores: {},
    vuelta: previo.vuelta + 1,
    enlace: resultado.invitacion.enlace,
    clienteDePrueba: {
      id: resultado.companyId,
      razonSocial: razonSocial.trim().replace(/\s+/g, " "),
      correo: String(formData.get("correo") ?? "").trim().toLowerCase(),
      entrega: resultado.invitacion.entrega,
      tarjetas: resultado.tarjetas.vinculada ? null : resultado.tarjetas.codigo,
    },
  };
}

export async function archivarClienteDePruebaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const id = String(formData.get("companyId") ?? "");
  try {
    await archivarClienteDePrueba(ctx, id);
  } catch (error) {
    return fallo(error, `/operacion/clientes/${id}`);
  }
  actualizar();
  redirect("/operacion/clientes?aviso=cliente_prueba_archivado");
}

export async function solicitarActivacionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const id = String(formData.get("companyId") ?? "");
  try {
    await solicitarActivacion(ctx, id);
  } catch (error) {
    return fallo(error, `/operacion/clientes/${id}`);
  }
  actualizar();
  redirect(`/operacion/clientes/${id}?aviso=activacion_solicitada`);
}

export async function decidirActivacionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  try {
    await decidirActivacion(ctx, sesion, {
      id: formData.get("id"),
      aprobada: formData.get("decision") === "aprobar",
      motivo: formData.get("motivo"),
    });
  } catch (error) {
    return fallo(error, "/operacion/aprobaciones");
  }
  actualizar();
  redirect("/operacion/aprobaciones?aviso=decision_registrada");
}

export async function invitarAdministradorAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const companyId = String(formData.get("companyId") ?? "");
  let resultado: Awaited<ReturnType<typeof invitarPrimerAdministrador>>;
  try {
    resultado = await invitarPrimerAdministrador(ctx, {
      companyId,
      nombre: formData.get("nombre"),
      correo: formData.get("correo"),
      vista: formData.get("vista"),
    });
  } catch (error) {
    return rechazado(previo, error, formData, ["nombre", "correo"]);
  }
  actualizar();
  // Si el correo no salió, la pantalla muestra el enlace para copiarlo. Va en la respuesta de este envío, nunca en la
  // dirección; la ficha se vuelve a pintar con la invitación nueva.
  if (resultado.entrega !== "enviada" && resultado.enlace) {
    refresh();
    return { aviso: `invitacion_${resultado.entrega}`, valores: {}, vuelta: previo.vuelta + 1, enlace: resultado.enlace };
  }
  redirect(`/operacion/clientes/${companyId}?aviso=invitacion_${resultado.entrega}`);
}

export async function crearAlertaAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await crearAlerta(ctx, {
      companyId: formData.get("companyId"),
      responsableId: formData.get("responsableId"),
      titulo: formData.get("titulo"),
      detalle: formData.get("detalle"),
    });
  } catch (error) {
    return rechazado(previo, error, formData, ["companyId", "responsableId", "titulo", "detalle"]);
  }
  actualizar();
  redirect("/operacion/alertas?aviso=alerta_creada");
}

export async function asignarAlertaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  try {
    await asignarAlerta(ctx, formData.get("id"), formData.get("responsableId"));
  } catch (error) {
    return fallo(error, "/operacion/alertas");
  }
  actualizar();
  redirect("/operacion/alertas?aviso=alerta_asignada");
}

export async function cerrarAlertaAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await cerrarAlerta(ctx, formData.get("id"), formData.get("motivo"));
  } catch (error) {
    return rechazado(previo, error, formData, ["motivo"]);
  }
  actualizar();
  redirect("/operacion/alertas?aviso=alerta_cerrada");
}

export async function solicitarComisionAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await solicitarComision(ctx, {
      companyId: formData.get("companyId"),
      tipo: formData.get("tipo"),
      valor: formData.get("valor"),
      vigenteDesde: formData.get("vigenteDesde"),
    });
  } catch (error) {
    return rechazado(previo, error, formData, ["companyId", "tipo", "valor", "vigenteDesde"]);
  }
  actualizar();
  redirect("/operacion/comisiones?aviso=comision_solicitada");
}

export async function actualizarPlanAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await actualizarPlan(ctx, {
      id: formData.get("id"),
      nombre: formData.get("nombre"),
      mensualidad: formData.get("mensualidad"),
      spei: formData.get("spei"),
    });
  } catch (error) {
    return rechazado(previo, error, formData, ["id", "nombre", "mensualidad", "spei"]);
  }
  actualizar();
  redirect("/operacion/comisiones?aviso=plan_actualizado");
}

export async function asignarPlanAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  try {
    await asignarPlan(ctx, { companyId: formData.get("companyId"), planId: formData.get("planId") });
  } catch (error) {
    return rechazado(previo, error, formData, ["companyId", "planId"]);
  }
  actualizar();
  redirect("/operacion/comisiones?aviso=plan_asignado");
}

export async function decidirComisionAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  try {
    await decidirComision(ctx, sesion, {
      id: formData.get("id"),
      aprobada: formData.get("decision") === "aprobar",
      motivo: formData.get("motivo"),
    });
  } catch (error) {
    return fallo(error, "/operacion/aprobaciones");
  }
  actualizar();
  redirect("/operacion/aprobaciones?aviso=decision_registrada");
}

/** Lo que vuelve al diálogo de «Rechazar» cuando el motivo no pasa: lo escrito y el aviso del campo. */
export type EstadoDelRechazo = { aviso: string | null; motivo: string; vuelta: number };

const RECHAZAR = { activacion: decidirActivacion, comision: decidirComision, suspension: decidirCambioDeSuspension };

/**
 * «Rechazar» desde Aprobaciones. Si el motivo no pasa (corto o vacío), el diálogo vuelve abierto con lo
 * escrito y el aviso ligado al campo, en lugar de cerrarse y perder el texto. Cualquier otro error, o el
 * rechazo asentado, vuelve a la página como antes.
 */
export async function rechazarConMotivoAccion(previo: EstadoDelRechazo, formData: FormData): Promise<EstadoDelRechazo> {
  const ctx = await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  const tipo = formData.get("tipo");
  const motivo = formData.get("motivo");
  try {
    if (tipo !== "activacion" && tipo !== "comision" && tipo !== "suspension") throw new ErrorDeDominio("dato_invalido_tipo");
    await RECHAZAR[tipo](ctx, sesion, { id: formData.get("id"), aprobada: false, motivo });
  } catch (error) {
    if (error instanceof ErrorDeDominio && (error.codigo === "motivo_corto" || error.codigo === "motivo_invalido")) {
      return { aviso: error.codigo, motivo: typeof motivo === "string" ? motivo : "", vuelta: previo.vuelta + 1 };
    }
    return fallo(error, "/operacion/aprobaciones");
  }
  actualizar();
  redirect("/operacion/aprobaciones?aviso=decision_registrada");
}

export async function salirOperacion(): Promise<void> {
  const jar = await cookies();
  const partes = [NOMBRE_COOKIE, NOMBRE_COOKIE_PARCIAL]
    .map((nombre) => [nombre, jar.get(nombre)?.value] as const)
    .filter(([, valor]) => Boolean(valor))
    .map(([nombre, valor]) => `${nombre}=${valor}`);
  const cierre = await cerrarSesion(partes.join("; ") || null);
  await fijarCookiesDeSesion(cierre.setCookies);
  const vacia = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 0 };
  jar.set(NOMBRE_COOKIE_ENTRADA_OPERACION, "", vacia);
  jar.set(NOMBRE_COOKIE_PORTAL_OPERACION, "", vacia);
  redirect("/operacion/entrar");
}

function actualizar(): void {
  revalidatePath("/operacion", "layout");
}

function fallo(error: unknown, destino: string): never {
  if (error instanceof ErrorDeDominio) redirect(`${destino}?aviso=${encodeURIComponent(error.codigo)}`);
  throw error;
}
