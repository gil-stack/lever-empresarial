import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { MarcoArco } from "@/components/entrar/marco-arco";
import { leerPaso, prepararTotp } from "@/server/autenticacion";
import { leerTokenEntrada } from "@/server/autenticacion/cookie";
import { NOMBRE_COOKIE_ENTRADA_OPERACION, NOMBRE_COOKIE_PORTAL_OPERACION } from "@/server/operacion/acceso";
import { contextoOperacion } from "@/server/operacion/contexto";
import { ErrorDeDominio } from "@/server/session";

import { ContinuarOperacion } from "@/components/operacion/continuar";
import type { AltaOperacion, PasoOperacion } from "../tipos-acceso";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Segundo factor · Operación" };

export default async function PaginaContinuarOperacion() {
  if (await contextoOperacion()) redirect("/operacion");
  const jar = await cookies();
  const portal = leerTokenEntrada(jar.get(NOMBRE_COOKIE_PORTAL_OPERACION)?.value);
  if (portal) {
    return <MarcoArco><ContinuarOperacion paso={{ paso: "inscribir", nombre: "", correo: "", porRecuperacion: false }} alta={null} yaInscrito /></MarcoArco>;
  }
  const token = leerTokenEntrada(jar.get(NOMBRE_COOKIE_ENTRADA_OPERACION)?.value);
  let paso: PasoOperacion;
  try {
    paso = await leerPaso(token);
  } catch (error) {
    if (error instanceof ErrorDeDominio) redirect("/operacion/entrar?aviso=entrada_vencida");
    throw error;
  }
  let alta: AltaOperacion = null;
  if (paso.paso === "inscribir") {
    try {
      alta = await prepararTotp(token);
    } catch (error) {
      if (!(error instanceof ErrorDeDominio && (error.codigo === "totp_no_disponible" || error.codigo === "qr_no_disponible"))) throw error;
    }
  }
  return <MarcoArco><ContinuarOperacion paso={paso} alta={alta} /></MarcoArco>;
}
