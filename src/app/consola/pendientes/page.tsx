import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { CABECERA_EMPRESA, enEmpresa } from "@/nucleo/rutas";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";

/**
 * Pendientes se unió con Aprobaciones (Ola 2b): la misma bandeja, cada
 * pendiente en un solo lugar, con la alerta de faltante y los atajos. Los
 * marcadores viejos llegan a Aprobaciones con la misma puerta de siempre: quien
 * no abría Pendientes sigue sin abrir nada. Sin base, la empresa sale de la
 * dirección (el proxy solo deja pasar un identificador válido) y Aprobaciones
 * pinta su aviso de error.
 */
export default async function PaginaPendientes() {
  const apertura = await abrirRuta("/consola/pendientes");
  if (apertura.tipo === "sin_permiso") notFound();
  const empresaId = apertura.tipo === "libro" ? (await headers()).get(CABECERA_EMPRESA) : apertura.ctx.empresa?.id;
  redirect(enEmpresa(empresaId, "/consola/aprobaciones"));
}
