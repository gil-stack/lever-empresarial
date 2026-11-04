"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { fijarCookieDeSesion } from "@/server/entrada";
import { cerrarSesion } from "@/server/session";
import { NOMBRE_COOKIE } from "@/server/session/cookie";

export async function salir(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(NOMBRE_COOKIE)?.value;
  const cierre = await cerrarSesion(token ? `${NOMBRE_COOKIE}=${token}` : null);
  await fijarCookieDeSesion(cierre.setCookie);
  redirect("/");
}

