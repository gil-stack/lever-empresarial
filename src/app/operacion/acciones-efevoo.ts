"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { rechazado, type EstadoDelFormulario } from "@/app/operacion/rechazo";
import {
  activarTarjetaEnEfevoo,
  asignarTarjetaEnEfevoo,
  cancelarTarjetaEnEfevoo,
  conciliarEnEfevoo,
  darDeAltaEnEfevoo,
  depositarDineroDePrueba,
  reintentarEnEfevoo,
} from "@/server/efevoo/operacion";
import type { Ejecutada } from "@/server/efevoo/operaciones";
import { exigirContextoOperacion } from "@/server/operacion";
import { ErrorDeDominio } from "@/server/session";

/**
 * Las acciones de la sección «Tarjetas (Efevoo)» de la ficha del cliente. Lo
 * que queda hecho (o resuelto como fallida o incierta) redirige a la ficha con
 * su aviso; un rechazo antes de llamar a Efevoo vuelve al formulario con lo
 * capturado (los formularios con campos) o a la ficha con su aviso (los botones).
 */

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : "";
}

function ficha(companyId: string): string {
  return `/operacion/clientes/${encodeURIComponent(companyId)}`;
}

function listo(companyId: string, aviso: string): never {
  revalidatePath("/operacion", "layout");
  redirect(`${ficha(companyId)}?aviso=${aviso}`);
}

function fallo(error: unknown, companyId: string): never {
  if (error instanceof ErrorDeDominio) redirect(`${ficha(companyId)}?aviso=${encodeURIComponent(error.codigo)}`);
  throw error;
}

/** El aviso de una operación ya resuelta: confirmada con su mensaje, o fallida o incierta. */
function avisoDe(op: Ejecutada, confirmada: string): string {
  if (!op.nueva) return "efevoo_ya_enviada";
  if (op.estado === "confirmada") return confirmada;
  if (op.estado === "incierta") return "efevoo_incierta";
  if (op.codigoEfevoo === "saldo_insuficiente") return "efevoo_saldo_insuficiente";
  return "efevoo_fallida";
}

export async function altaEfevooAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let aviso: string;
  try {
    aviso = avisoDe(await darDeAltaEnEfevoo(ctx, { companyId, llave: texto(formData, "llave") }), "efevoo_alta_confirmada");
  } catch (error) {
    return fallo(error, companyId);
  }
  listo(companyId, aviso);
}

export async function depositoEfevooAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let aviso: string;
  try {
    aviso = avisoDe(await depositarDineroDePrueba(ctx, { companyId, llave: texto(formData, "llave"), monto: texto(formData, "monto") }), "efevoo_deposito_confirmado");
  } catch (error) {
    return rechazado(previo, error, formData, ["monto"]);
  }
  listo(companyId, aviso);
}

const CAMPOS_TITULAR = ["employeeId", "inventarioId", "ultimos8", "nombre", "primerApellido", "segundoApellido", "nombreEmbozar", "telefono", "correo", "paisNacimiento", "domicilio"];

export async function asignarEfevooAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let aviso: string;
  try {
    const { asignacion, activacion } = await asignarTarjetaEnEfevoo(ctx, {
      companyId,
      llave: texto(formData, "llave"),
      llaveActivacion: texto(formData, "llaveActivacion"),
      ...Object.fromEntries(CAMPOS_TITULAR.map((c) => [c, texto(formData, c)])),
    } as Parameters<typeof asignarTarjetaEnEfevoo>[1]);
    aviso = asignacion.estado !== "confirmada" || !asignacion.nueva
      ? avisoDe(asignacion, "efevoo_tarjeta_activada")
      : !activacion
        ? "efevoo_tarjeta_asignada_sin_activar"
        : activacion.estado === "confirmada" ? "efevoo_tarjeta_activada" : "efevoo_tarjeta_asignada_sin_activar";
  } catch (error) {
    // Los datos del titular no viajan de regreso a la página: se vuelven a escribir.
    return rechazado(previo, error, formData, ["employeeId", "inventarioId", "nombreEmbozar", "paisNacimiento"]);
  }
  listo(companyId, aviso);
}

export async function activarEfevooAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let aviso: string;
  try {
    aviso = avisoDe(await activarTarjetaEnEfevoo(ctx, { companyId, llave: texto(formData, "llave"), tarjetaId: texto(formData, "tarjetaId") }), "efevoo_tarjeta_activada");
  } catch (error) {
    return fallo(error, companyId);
  }
  listo(companyId, aviso);
}

export async function cancelarEfevooAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let aviso: string;
  try {
    aviso = avisoDe(await cancelarTarjetaEnEfevoo(ctx, {
      companyId,
      llave: texto(formData, "llave"),
      tarjetaId: texto(formData, "tarjetaId"),
      motivo: texto(formData, "motivo"),
      confirmacion: texto(formData, "confirmacion"),
    }), "efevoo_tarjeta_cancelada");
  } catch (error) {
    return rechazado(previo, error, formData, ["motivo"]);
  }
  listo(companyId, aviso);
}

const AVISO_CONCILIACION = {
  confirmada: "efevoo_conciliada",
  no_aparecio: "efevoo_no_aparecio",
  espera: "efevoo_espera",
  ambigua: "efevoo_ambigua",
  ya_resuelta: "efevoo_ya_resuelta",
} as const;

export async function conciliarEfevooAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let aviso: string;
  try {
    aviso = AVISO_CONCILIACION[(await conciliarEnEfevoo(ctx, { companyId, operacionId: texto(formData, "operacionId") })).resultado];
  } catch (error) {
    return fallo(error, companyId);
  }
  listo(companyId, aviso);
}

export async function reintentarEfevooAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  const companyId = texto(formData, "companyId");
  let aviso: string;
  try {
    aviso = avisoDe(await reintentarEnEfevoo(ctx, { companyId, operacionId: texto(formData, "operacionId"), llave: texto(formData, "llave") }), "efevoo_reintento_confirmado");
  } catch (error) {
    return fallo(error, companyId);
  }
  listo(companyId, aviso);
}
