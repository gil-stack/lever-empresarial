"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resolverRecuperacion } from "@/server/autenticacion";
import { sesionSegura } from "@/server/entrada";
import { exigirContextoOperacion } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";
import { ErrorDeDominio } from "@/server/session";

/**
 * Aprobar o rechazar que alguien registre un segundo factor nuevo. Solo con
 * sesión SOFIPO, con el factor confirmado hace cinco minutos o menos, y nunca
 * la propia solicitud: el servicio y la base lo vuelven a exigir.
 *
 * Rechazar y Aprobar comparten formulario y acción: el botón oprimido manda
 * `decision`, y así el formulario sabe cuál dice «Enviando…». Cualquier otro
 * valor se trata como rechazo, que exige nota y no concede nada.
 */
export async function decidirRecuperacionAccion(formData: FormData): Promise<void> {
  const aprobada = formData.get("decision") === "aprobar";
  const ctx = await exigirContextoOperacion();
  if (!puedeEnOperacion(ctx, "plataforma.empresa.alta")) redirect("/operacion/recuperaciones?aviso=sin_permiso_operacion");
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
      // Con varias solicitudes pendientes, el aviso marca y enfoca solo la tarjeta que se envió: va su id, nada más.
      const id = formData.get("id");
      const en = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? `&en=${id}` : "";
      redirect(`/operacion/recuperaciones?aviso=${encodeURIComponent(aviso)}${en}`);
    }
    throw error;
  }
  revalidatePath("/operacion/recuperaciones");
  redirect("/operacion/recuperaciones?aviso=decision_registrada");
}
