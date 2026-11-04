"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { NOMBRE_COOKIE_ENTRADA, NOMBRE_COOKIE_PORTAL } from "@/server/autenticacion/cookie";
import { fijarCookiesDeSesion } from "@/server/entrada";
import { cerrarSesion } from "@/server/session";
import { NOMBRE_COOKIE, NOMBRE_COOKIE_PARCIAL } from "@/server/session/cookie";

export async function salir(): Promise<void> {
  const jar = await cookies();
  const partes = [NOMBRE_COOKIE, NOMBRE_COOKIE_PARCIAL]
    .map((nombre) => [nombre, jar.get(nombre)?.value] as const)
    .filter(([, valor]) => Boolean(valor))
    .map(([nombre, valor]) => `${nombre}=${valor}`);
  const cierre = await cerrarSesion(partes.join("; ") || null);
  await fijarCookiesDeSesion(cierre.setCookies);
  const vacia = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 0 };
  jar.set(NOMBRE_COOKIE_ENTRADA, "", vacia);
  jar.set(NOMBRE_COOKIE_PORTAL, "", vacia);
  redirect("/");
}
