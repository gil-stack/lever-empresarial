"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { fijarCookieDeSesion } from "@/server/entrada";
import { ErrorDeDominio, cerrarSesion, entrar } from "@/server/session";
import { NOMBRE_COOKIE } from "@/server/session/cookie";
import type { EstadoEntrada } from "./estado";

export async function salir(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(NOMBRE_COOKIE)?.value;
  const cierre = await cerrarSesion(token ? `${NOMBRE_COOKIE}=${token}` : null);
  await fijarCookieDeSesion(cierre.setCookie);
  redirect("/");
}

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
  redirect("/consola");
}
