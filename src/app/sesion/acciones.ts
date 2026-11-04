"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RUTA_SEGUNDO_FACTOR } from "@/nucleo/rutas";
import { fijarCookieDeSesion, fijarCookiesDeSesion } from "@/server/entrada";
import { ErrorDeDominio, cerrarSesion, entrar } from "@/server/session";
import { NOMBRE_COOKIE, NOMBRE_COOKIE_PARCIAL } from "@/server/session/cookie";
import type { EstadoEntrada } from "./estado";

export async function salir(): Promise<void> {
  const jar = await cookies();
  const partes = [NOMBRE_COOKIE, NOMBRE_COOKIE_PARCIAL]
    .map((nombre) => [nombre, jar.get(nombre)?.value] as const)
    .filter(([, valor]) => Boolean(valor))
    .map(([nombre, valor]) => `${nombre}=${valor}`);
  const cierre = await cerrarSesion(partes.join("; ") || null);
  await fijarCookiesDeSesion(cierre.setCookies);
  redirect("/");
}

/** La contraseña abre una sesión parcial. El portal se abre después del segundo factor. */
export async function enviarEntrada(
  _previo: EstadoEntrada,
  formData: FormData,
): Promise<EstadoEntrada> {
  try {
    const abierta = await entrar({
      correo: String(formData.get("correo") ?? ""),
      contrasena: String(formData.get("contrasena") ?? ""),
    });
    await fijarCookieDeSesion(abierta.setCookie);
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      if (error.codigo === "credenciales_invalidas") {
        return { tipo: "invalido", mensaje: "El correo o la contraseña no coinciden." };
      }
      return { tipo: "invalido", mensaje: "No se pudo entrar. Vuelve a intentar." };
    }
    throw error;
  }
  redirect(RUTA_SEGUNDO_FACTOR);
}
