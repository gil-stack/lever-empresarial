"use server";

import { revalidatePath } from "next/cache";

import type { EstadoMinimo } from "@/components/flujo/estado-minimo";
import { contextoDeAccion, errorConSecreto } from "@/server/entrada";
import { configurarMesesMinimos } from "@/server/flujo/runway";
import { ErrorDeCaptura } from "@/server/flujo/servicio";
import { ErrorDeDominio } from "@/server/session";

const RECHAZO: Record<string, { titulo: string; mensaje: string }> = {
  sin_permiso: { titulo: "Sin permiso para cambiar el flujo", mensaje: "Tu rol puede ver el flujo de caja, pero lo cambian administración o finanzas." },
  sesion_ausente: { titulo: "Tu sesión terminó", mensaje: "Vuelve a entrar y repite el cambio." },
  sin_empresa: { titulo: "Sin empresa elegida", mensaje: "Elige la empresa desde el menú y repite el cambio." },
  auditoria_no_disponible: { titulo: "No se guardó", mensaje: "No se pudo dejar el registro en la bitácora, así que el cambio no se aplicó." },
  base_no_disponible: { titulo: "No se guardó", mensaje: "La base no respondió. No se aplicó ningún cambio; vuelve a intentar." },
};

/**
 * El mínimo de meses del aviso de runway. Responde con lo escrito: sin
 * JavaScript la página se vuelve a pintar con el rechazo y el campo conserva
 * lo que la persona capturó.
 */
export async function enviarMinimo(_previo: EstadoMinimo, formData: FormData): Promise<EstadoMinimo> {
  const valor = formData.get("meses");
  const escrito = typeof valor === "string" ? valor.slice(0, 20) : "";
  try {
    const meses = await configurarMesesMinimos(await contextoDeAccion(), { meses: escrito });
    for (const ruta of ["/consola", "/consola/flujo"]) revalidatePath(ruta);
    return {
      tipo: "listo",
      mensaje: `Te avisamos cuando el runway conservador baje de ${meses} ${meses === 1 ? "mes" : "meses"}. La revisión corre cada 15 minutos, de 7:00 a 21:45.`,
      escrito: String(meses),
    };
  } catch (error) {
    if (error instanceof ErrorDeCaptura) return { tipo: "invalido", errores: error.errores, escrito };
    if (error instanceof ErrorDeDominio) return { tipo: "rechazado", ...(RECHAZO[error.codigo] ?? RECHAZO.base_no_disponible!), escrito };
    if (errorConSecreto(error)) return { tipo: "rechazado", ...RECHAZO.base_no_disponible!, escrito };
    throw error;
  }
}
