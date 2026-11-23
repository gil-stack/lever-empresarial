"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirContextoOperacion, guardarAjusteDeAlerta } from "@/server/operacion";
import { ErrorDeDominio } from "@/server/session";

/**
 * Guarda cómo se comporta un tipo de alerta automática: prendida o apagada, y a quién se asigna. El servicio exige
 * la Administración de la plataforma y deja el evento en la bitácora; un rechazo vuelve a Alertas con su aviso.
 */
export async function guardarAjusteDeAlertaAccion(formData: FormData): Promise<void> {
  const ctx = await exigirContextoOperacion();
  try {
    await guardarAjusteDeAlerta(ctx, {
      categoria: formData.get("categoria"),
      activa: formData.get("activa"),
      responsableId: formData.get("responsableId"),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio) redirect(`/operacion/alertas?aviso=${encodeURIComponent(error.codigo)}`);
    throw error;
  }
  revalidatePath("/operacion", "layout");
  redirect("/operacion/alertas?aviso=alerta_configurada");
}
