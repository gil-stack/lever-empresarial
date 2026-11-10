"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { rechazado, type EstadoDelFormulario } from "@/app/operacion/rechazo";
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
 *
 * Con varias solicitudes pendientes, cada tarjeta lleva su formulario: un rechazo vuelve a esa tarjeta con lo
 * elegido y lo escrito, y la página se vuelve a pintar (si el factor caducó, aparece «Confirma que eres tú»).
 */
export async function decidirRecuperacionAccion(previo: EstadoDelFormulario, formData: FormData): Promise<EstadoDelFormulario> {
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
    const reautenticar = error instanceof ErrorDeDominio && error.codigo === "reautenticacion_requerida";
    return rechazado(previo, error, formData, ["verificacion", "nota"], reautenticar ? "reautenticacion_factor" : undefined);
  }
  revalidatePath("/operacion/recuperaciones");
  redirect("/operacion/recuperaciones?aviso=decision_registrada");
}
