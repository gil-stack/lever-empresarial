"use server";

import { revalidatePath } from "next/cache";

import type { EstadoFlujo } from "@/dominio/flujo/entradas";
import { contextoDeAccion, errorConSecreto } from "@/server/entrada";
import {
  asignarAreaProveedor,
  cambiarCorreoSemanal,
  cancelarCobro,
  configurarColchon,
  declararSaldo,
  desactivarObligacion,
  editarObligacion,
  ErrorDeCaptura,
  marcarCobrado,
  registrarCobro,
  registrarCobroCfdi,
  registrarObligacion,
} from "@/server/flujo/servicio";
import { ErrorDeDominio } from "@/server/session";

/**
 * Acciones del flujo de caja. Cada una vuelve a pedir el contexto de la
 * sesión; el servicio exige cliente.flujo.editar aunque el formulario llegue
 * armado a mano.
 */

const RECHAZO: Record<string, { titulo: string; mensaje: string }> = {
  sin_permiso: { titulo: "Sin permiso para cambiar el flujo", mensaje: "Tu rol puede ver el flujo de caja, pero lo cambian administración o finanzas." },
  sesion_ausente: { titulo: "Tu sesión terminó", mensaje: "Vuelve a entrar y repite el cambio." },
  sin_empresa: { titulo: "Sin empresa elegida", mensaje: "Elige la empresa desde el menú y repite el cambio." },
  cobro_ya_resuelto: { titulo: "Ese cobro ya estaba resuelto", mensaje: "Alguien lo marcó como cobrado o cancelado antes. Recarga la lista." },
  cobro_ausente: { titulo: "No encontramos ese cobro", mensaje: "Recarga la lista y vuelve a intentar." },
  cobro_duplicado: { titulo: "Esa factura ya está registrada", mensaje: "Ya hay un cobro esperado con la misma factura. Si la quieres registrar otra vez, cancela primero el que está." },
  cobro_ya_cobrado: { titulo: "Esa factura ya se cobró", mensaje: "La misma factura ya está registrada y marcada como cobrada. No hace falta registrarla otra vez." },
  obligacion_inactiva: { titulo: "Esa obligación ya no está activa", mensaje: "Recarga el calendario." },
  obligacion_ausente: { titulo: "No encontramos esa obligación", mensaje: "Recarga el calendario." },
  area_ajena: { titulo: "Esa área no es de esta empresa", mensaje: "Elige un área de la lista." },
  proveedor_ausente: { titulo: "No encontramos ese proveedor", mensaje: "Recarga la página." },
  fecha_futura: { titulo: "Fecha en el futuro", mensaje: "Esa fecha todavía no llega." },
  entrada_invalida: { titulo: "No se entendió el cambio", mensaje: "Vuelve a intentar desde la página." },
  auditoria_no_disponible: { titulo: "No se guardó", mensaje: "No se pudo dejar el registro en la bitácora, así que el cambio no se aplicó." },
  base_no_disponible: { titulo: "No se guardó", mensaje: "La base no respondió. No se aplicó ningún cambio; vuelve a intentar." },
};

function traducir(error: unknown): EstadoFlujo {
  if (error instanceof ErrorDeCaptura) return { tipo: "invalido", errores: error.errores };
  if (error instanceof ErrorDeDominio) {
    const rechazo = RECHAZO[error.codigo] ?? RECHAZO.base_no_disponible!;
    return { tipo: "rechazado", ...rechazo };
  }
  if (errorConSecreto(error)) return { tipo: "rechazado", ...RECHAZO.base_no_disponible! };
  throw error;
}

function refrescar(): void {
  for (const ruta of ["/consola", "/consola/flujo", "/consola/cobros", "/consola/calendario", "/consola/presupuestos", "/consola/pendientes"]) {
    revalidatePath(ruta);
  }
}

async function ejecutar(fn: () => Promise<string>): Promise<EstadoFlujo> {
  try {
    const mensaje = await fn();
    refrescar();
    return { tipo: "listo", mensaje };
  } catch (error) {
    return traducir(error);
  }
}

function campos(formData: FormData, nombres: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(nombres.map((nombre) => [nombre, formData.get(nombre) ?? undefined]));
}

export async function enviarSaldo(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await declararSaldo(await contextoDeAccion(), campos(formData, ["saldo", "alDia", "altaId"]));
    return "El saldo quedó declarado. La proyección ya parte de él; la declaración anterior sigue en el historial.";
  });
}

export async function enviarColchon(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await configurarColchon(await contextoDeAccion(), { colchon: formData.get("colchon") ?? undefined });
    return "El colchón quedó guardado. La alerta de faltante avisa cuando el saldo proyectado baje de él.";
  });
}

export async function enviarCorreoSemanal(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const activo = await cambiarCorreoSemanal(await contextoDeAccion(), { activo: formData.get("activo") ?? undefined });
    return activo ? "Recibirás el resumen los lunes a las 8:00." : "Ya no recibirás el resumen de los lunes.";
  });
}

export async function enviarCobro(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await registrarCobro(await contextoDeAccion(), campos(formData, ["clienteNombre", "clienteRfc", "concepto", "monto", "fechaProbable", "referencia", "altaId"]));
    return "El cobro quedó registrado como esperado y ya cuenta en la proyección.";
  });
}

export async function enviarCobroXml(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const archivo = formData.get("xml");
    const bytes = archivo instanceof File && archivo.size > 0 && archivo.size <= 2_000_000 ? new Uint8Array(await archivo.arrayBuffer()) : null;
    if (archivo instanceof File && archivo.size > 2_000_000) {
      throw new ErrorDeCaptura([{ campo: "xml", mensaje: "El XML pesa más de 2 MB." }]);
    }
    const hecho = await registrarCobroCfdi(await contextoDeAccion(), {
      bytes,
      fechaProbable: formData.get("fechaProbableXml") ?? undefined,
      concepto: formData.get("conceptoXml") ?? undefined,
      altaId: formData.get("altaId") ?? undefined,
    });
    return `La factura a ${hecho.cliente} quedó registrada como cobro esperado.`;
  });
}

export async function enviarCobrado(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await marcarCobrado(await contextoDeAccion(), campos(formData, ["id", "cobradoEl"]));
    return "El cobro quedó marcado como cobrado. Si llegó después del saldo declarado, la proyección lo cuenta en la semana en que llegó.";
  });
}

export async function enviarCancelacionCobro(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await cancelarCobro(await contextoDeAccion(), campos(formData, ["id", "motivo"]));
    return "El cobro quedó cancelado con su motivo. Sale de la proyección.";
  });
}

export async function enviarObligacion(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    const entrada = campos(formData, ["id", "concepto", "monto", "frecuencia", "proximaFecha", "areaId", "proveedorId", "altaId"]);
    if (typeof entrada.id === "string" && entrada.id !== "") {
      await editarObligacion(await contextoDeAccion(), entrada);
      return "La obligación quedó actualizada.";
    }
    await registrarObligacion(await contextoDeAccion(), entrada);
    return "La obligación quedó registrada y ya aparece en el calendario y en la proyección.";
  });
}

export async function enviarDesactivarObligacion(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await desactivarObligacion(await contextoDeAccion(), { id: formData.get("id") ?? undefined });
    return "La obligación se desactivó y sale del calendario y de la proyección.";
  });
}

export async function enviarAreaProveedor(_previo: EstadoFlujo, formData: FormData): Promise<EstadoFlujo> {
  return ejecutar(async () => {
    await asignarAreaProveedor(await contextoDeAccion(), campos(formData, ["proveedorId", "areaId"]));
    return "El área del proveedor quedó guardada. Sus pagos del mes ya cuentan en el presupuesto del área.";
  });
}
