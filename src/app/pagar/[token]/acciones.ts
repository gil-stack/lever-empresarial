"use server";

import { pedirSinRecordatorios } from "@/server/cobranza/pagador";
import { errorConSecreto } from "@/server/entrada";

export type EstadoSinRecordatorios = { tipo: "inicial" } | { tipo: "hecho" } | { tipo: "rechazado"; mensaje: string };

/** El pagador pide no recibir recordatorios desde su enlace. No hay sesión: el token es la llave. */
export async function enviarSinRecordatorios(_previo: EstadoSinRecordatorios, formData: FormData): Promise<EstadoSinRecordatorios> {
  try {
    const hecho = await pedirSinRecordatorios(formData.get("token"));
    return hecho ? { tipo: "hecho" } : { tipo: "rechazado", mensaje: "Este enlace ya no es válido. Pide uno nuevo a quien te cobra." };
  } catch (error) {
    if (errorConSecreto(error)) return { tipo: "rechazado", mensaje: "No pudimos guardarlo. Intenta de nuevo en un momento." };
    console.error("[cobranza] el pagador no pudo pedir que no le recuerden", { error: error instanceof Error ? error.name : "desconocido" });
    return { tipo: "rechazado", mensaje: "No pudimos guardarlo. Intenta de nuevo en un momento." };
  }
}
