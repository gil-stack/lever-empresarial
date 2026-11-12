"use server";

import { revalidatePath } from "next/cache";

import type { EstadoFlujo } from "@/dominio/flujo/entradas";
import { leerMontoTarjeta, type OperacionTarjeta } from "@/dominio/tarjetas/vista";
import { contextoDeAccion, errorConSecreto, sesionSegura } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";
import {
  cambiarBloqueoTarjeta,
  conciliarOperacionTarjeta,
  moverSaldoTarjeta,
  reintentarOperacionTarjeta,
  type ResultadoOperacion,
} from "@/server/tarjetas";

/**
 * Acciones de Tarjetas con Efevoo. Cada una vuelve a pedir el contexto de la sesión y el servicio exige
 * cliente.tarjetas.operar aunque el formulario llegue armado a mano. La llave de intento viaja en el formulario: el
 * doble clic y el reenvío regresan la misma operación.
 */

const RECHAZO: Record<string, { titulo: string; mensaje: string }> = {
  sin_permiso: { titulo: "Sin permiso para operar tarjetas", mensaje: "Tu rol puede ver las tarjetas; las cargan, retiran y bloquean administración y liberación." },
  sesion_ausente: { titulo: "Tu sesión terminó", mensaje: "Vuelve a entrar y repite la operación." },
  reautenticacion_requerida: { titulo: "Confirma que eres tú", mensaje: "Mover saldo o reintentar exige un segundo factor de los últimos 30 minutos. Sal, vuelve a entrar y repite la operación." },
  sin_empresa: { titulo: "Sin empresa elegida", mensaje: "Elige la empresa desde el menú y repite la operación." },
  tarjeta_ausente: { titulo: "No encontramos esa tarjeta", mensaje: "Recarga la página." },
  tarjeta_no_operable: { titulo: "Esa tarjeta no se puede operar", mensaje: "Está cancelada o todavía no se activa." },
  saldo_insuficiente: { titulo: "No alcanza el saldo", mensaje: "Efevoo dice que no hay saldo suficiente. No se movió dinero." },
  operacion_ausente: { titulo: "No encontramos esa operación", mensaje: "Recarga la página." },
  operacion_no_incierta: { titulo: "Esa operación ya está resuelta", mensaje: "Recarga la página para ver su estado." },
  operacion_no_reintentable: { titulo: "Concíliala antes de reintentar", mensaje: "Solo se reintenta una operación que se buscó en Efevoo y no apareció." },
  intento_invalido: { titulo: "No se entendió el formulario", mensaje: "Recarga la página y vuelve a intentar." },
  entrada_invalida: { titulo: "No se entendió el formulario", mensaje: "Recarga la página y vuelve a intentar." },
  monto_invalido: { titulo: "Revisa el monto", mensaje: "Escribe un monto mayor que cero, en pesos y con centavos válidos." },
  intento_con_otros_datos: { titulo: "Este formulario ya se envió con otros datos", mensaje: "Cierra el diálogo y ábrelo de nuevo para una operación nueva." },
  operacion_en_curso: { titulo: "Esa tarjeta tiene una operación sin terminar", mensaje: "Espera a que se confirme o concíliala en «Operaciones por confirmar»." },
  tarjeta_en_cancelacion: { titulo: "Esa tarjeta se está cancelando", mensaje: "No se puede operar mientras se cancela." },
  tarjeta_no_encontrada: { titulo: "No encontramos esa tarjeta", mensaje: "Recarga la página." },
  tarjeta_en_otro_estado: { titulo: "La tarjeta cambió de estado", mensaje: "Recarga la página para ver cómo está ahora." },
  sin_permiso_para_efevoo: { titulo: "Sin permiso para operar tarjetas", mensaje: "Tu rol puede ver las tarjetas; las cargan, retiran y bloquean administración y liberación." },
  empresa_sin_vinculo: { titulo: "Tarjetas no está conectada", mensaje: "La empresa no está dada de alta con el emisor. Comunícate con Lever." },
  operacion_no_encontrada: { titulo: "No encontramos esa operación", mensaje: "Recarga la página." },
  reintento_no_valido: { titulo: "Concíliala antes de reintentar", mensaje: "Solo se reintenta una operación que se buscó en Efevoo y no apareció." },
  efevoo_no_configurado: { titulo: "Tarjetas no está conectada", mensaje: "La conexión con el emisor no está configurada. Comunícate con Lever." },
  efevoo_no_autorizado: { titulo: "El emisor rechazó la conexión", mensaje: "No se movió dinero. Lever ya tiene el aviso." },
  efevoo_rechazo: { titulo: "El emisor no hizo la operación", mensaje: "No se movió dinero. Revisa el detalle de la operación." },
  empresa_suspendida: { titulo: "La empresa está suspendida", mensaje: "No se pueden mover dinero ni cambiar tarjetas mientras esté suspendida. Comunícate con Lever." },
  auditoria_no_disponible: { titulo: "No se hizo", mensaje: "No se pudo dejar el registro en la bitácora, así que no se llamó al emisor." },
  base_no_disponible: { titulo: "No se hizo", mensaje: "La base no respondió. No se llamó al emisor; vuelve a intentar." },
};

function traducir(error: unknown): EstadoFlujo {
  if (error instanceof ErrorDeDominio) return { tipo: "rechazado", ...(RECHAZO[error.codigo] ?? RECHAZO.base_no_disponible!) };
  if (errorConSecreto(error)) return { tipo: "rechazado", ...RECHAZO.base_no_disponible! };
  throw error;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function campo(datos: FormData, nombre: string): string {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
}

function uuid(datos: FormData, nombre: string): string {
  const valor = campo(datos, nombre);
  if (!UUID.test(valor)) throw new ErrorDeDominio("intento_invalido");
  return valor.toLowerCase();
}

/** Lo que pasó, dicho en palabras: confirmada, en proceso, incierta o fallida. */
function resultado(r: ResultadoOperacion, hecho: string): EstadoFlujo {
  const previo = r.existente ? "Esa operación ya se había enviado; no se repitió. " : "";
  const { operacion } = r;
  if (operacion.estado === "fallida") return { tipo: "rechazado", ...RECHAZO.efevoo_rechazo!, mensaje: `${previo}${mensajeFallida(operacion)}` };
  if (operacion.estado === "incierta") {
    return { tipo: "listo", mensaje: `${previo}El emisor no confirmó la operación ${operacion.referencia}. No se repite sola: usa «Conciliar» para buscarla.` };
  }
  if (operacion.estado === "pendiente") return { tipo: "listo", mensaje: `${previo}La operación ${operacion.referencia} está en proceso.` };
  return { tipo: "listo", mensaje: `${previo}${hecho} Referencia ${operacion.referencia}.` };
}

function mensajeFallida(operacion: OperacionTarjeta): string {
  if (operacion.codigoEfevoo === "saldo_insuficiente") {
    return operacion.tipo === "retiro"
      ? "No alcanza el saldo de la tarjeta para ese retiro. No se llamó al emisor ni se movió dinero."
      : "No alcanza el saldo para tarjetas de la empresa para esa carga. Hay otras cargas por confirmar en la empresa que también cuentan. No se llamó al emisor ni se movió dinero.";
  }
  return operacion.codigoEfevoo ? `El emisor la rechazó (código ${operacion.codigoEfevoo}). No se movió dinero.` : "El emisor la rechazó. No se movió dinero.";
}

function refrescar(): void {
  revalidatePath("/consola/tarjetas");
  revalidatePath("/telefono/tarjetas");
}

async function ejecutar(fn: () => Promise<EstadoFlujo>): Promise<EstadoFlujo> {
  try {
    const estado = await fn();
    refrescar();
    return estado;
  } catch (error) {
    return traducir(error);
  }
}

/** Cargar o retirar saldo de una tarjeta. El saldo se revisa antes en el servidor y Efevoo lo vuelve a revisar. */
export async function enviarSaldoTarjeta(_previo: EstadoFlujo, datos: FormData): Promise<EstadoFlujo> {
  const tipo = campo(datos, "tipo");
  if (tipo !== "carga" && tipo !== "retiro") return { tipo: "rechazado", ...RECHAZO.intento_invalido! };
  const monto = leerMontoTarjeta(campo(datos, "monto"), null);
  if (monto.tipo === "invalido") return { tipo: "invalido", errores: [{ campo: "monto", mensaje: "Escribe un monto mayor que cero, en pesos y con centavos válidos." }] };
  return ejecutar(async () => {
    const r = await moverSaldoTarjeta(await contextoDeAccion(), await sesionSegura(), { tarjetaId: campo(datos, "tarjetaId"), tipo, centavos: monto.centavos, intento: uuid(datos, "intento") });
    return resultado(r, tipo === "carga" ? "Se cargó el saldo a la tarjeta." : "Se retiró el saldo de la tarjeta.");
  });
}

export async function enviarBloqueoTarjeta(_previo: EstadoFlujo, datos: FormData): Promise<EstadoFlujo> {
  const accion = campo(datos, "accion");
  if (accion !== "bloqueo" && accion !== "desbloqueo") return { tipo: "rechazado", ...RECHAZO.intento_invalido! };
  return ejecutar(async () => {
    const r = await cambiarBloqueoTarjeta(await contextoDeAccion(), { tarjetaId: campo(datos, "tarjetaId"), accion, intento: uuid(datos, "intento") });
    return resultado(r, accion === "bloqueo" ? "La tarjeta quedó bloqueada." : "La tarjeta quedó desbloqueada.");
  });
}

export async function enviarConciliacion(_previo: EstadoFlujo, datos: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const c = await conciliarOperacionTarjeta(await contextoDeAccion(), uuid(datos, "operacionId"));
    const ref = c.operacion.referencia;
    switch (c.resultado) {
      case "confirmada":
        return { tipo: "listo", mensaje: `La operación ${ref} sí se hizo en el emisor. Quedó confirmada.` };
      case "no_aparecio":
        return { tipo: "listo", mensaje: `La operación ${ref} no aparece en el emisor. No se movió dinero; puedes reintentarla.` };
      case "espera":
        return { tipo: "rechazado", titulo: "Todavía no aparece", mensaje: `El emisor puede tardar en reflejarla. Vuelve a conciliar en ${c.minutos} min.` };
      case "ambigua":
        return { tipo: "rechazado", titulo: "Todavía no se puede confirmar", mensaje: `La operación ${ref} todavía no se puede confirmar; vuelve a conciliar en unos minutos o revísalo con Operación.` };
      case "ya_resuelta":
        return { tipo: "listo", mensaje: `La operación ${ref} ya estaba resuelta.` };
    }
  });
}

export async function enviarReintento(_previo: EstadoFlujo, datos: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const r = await reintentarOperacionTarjeta(await contextoDeAccion(), await sesionSegura(), uuid(datos, "operacionId"), uuid(datos, "intento"));
    return resultado(r, "Se reintentó con una referencia nueva.");
  });
}
