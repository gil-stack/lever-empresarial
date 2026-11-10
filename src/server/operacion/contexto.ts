import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import type { ContextoDePersonal } from "../../nucleo/contexto";
import { exigirPersonal } from "../../nucleo/contexto";
import { CABECERA_PETICION } from "../../nucleo/rutas";
import { NOMBRE_COOKIE } from "../session/cookie";
import { leerSesion } from "../session/servicio";
import { resolverContexto } from "../tenencia/resolver";

/** La cookie no basta: la fila de sesión debe pertenecer a la superficie SOFIPO. */
export const contextoOperacion = cache(async (): Promise<ContextoDePersonal | null> => {
  const jar = await cookies();
  const token = jar.get(NOMBRE_COOKIE)?.value;
  if (!token) return null;
  const sesion = await leerSesion(`${NOMBRE_COOKIE}=${token}`);
  if (!sesion?.segundoFactor || sesion.superficie !== "sofipo") return null;
  const cabeceras = await headers();
  const { ctx } = await resolverContexto({
    sesion,
    empresaPedida: null,
    peticionId: cabeceras.get(CABECERA_PETICION),
    superficie: "sofipo",
  });
  if (!ctx.personal) return null;
  // Cualquier rol de la plataforma entra a Operación; cada página y cada acción piden su capacidad.
  return exigirPersonal(ctx, "plataforma.operacion.ver");
});

export async function exigirContextoOperacion(): Promise<ContextoDePersonal> {
  const ctx = await contextoOperacion();
  if (!ctx) redirect("/operacion/entrar");
  return ctx;
}
