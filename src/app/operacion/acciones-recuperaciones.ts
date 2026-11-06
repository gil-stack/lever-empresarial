"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolverRecuperacion } from "@/server/autenticacion";
import { sesionSegura } from "@/server/entrada";
import { exigirContextoOperacion } from "@/server/operacion";
import { ErrorDeDominio } from "@/server/session";

/**
 * Aprobar o rechazar que alguien registre un segundo factor nuevo. Solo con
 * sesión SOFIPO, con el factor confirmado hace cinco minutos o menos, y nunca
 * la propia solicitud: el servicio y la base lo vuelven a exigir.
 */
export async function aprobarRecuperacionAccion(formData: FormData): Promise<void> {
  await resolver(formData, true);
}

export async function rechazarRecuperacionAccion(formData: FormData): Promise<void> {
  await resolver(formData, false);
}

async function resolver(formData: FormData, aprobada: boolean): Promise<void> {
  await exigirContextoOperacion();
  const sesion = await sesionSegura();
  if (!sesion) redirect("/operacion/entrar");
  try {
    await resolverRecuperacion(sesion, {
      id: formData.get("id"),
      aprobada,
      verificacion: formData.get("verificacion"),
      nota: formData.get("nota"),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      const aviso = error.codigo === "reautenticacion_requerida" ? "reautenticacion_factor" : error.codigo;
      redirect(`/operacion/recuperaciones?aviso=${encodeURIComponent(aviso)}`);
    }
    throw error;
  }
  revalidatePath("/operacion/recuperaciones");
  redirect("/operacion/recuperaciones?aviso=decision_registrada");
}
