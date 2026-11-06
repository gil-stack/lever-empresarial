import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { MaestroCerrado } from "@/components/personas/maestro";
import { PantallaNomina } from "@/components/personas/nomina";
import { hoyEnMexico } from "@/dominio/personas";
import { puede } from "@/nucleo/contexto";
import { leerNomina } from "@/server/nomina";
import type { LecturaNomina } from "@/server/nomina/tipos";

import { abrirPersonas, errorDePersonas, type AvisoPersonas } from "../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Nómina · Personas" };

export default async function PaginaNomina() {
  const apertura = await abrirPersonas("/consola/personas/nomina");
  let lectura: LecturaNomina | null = null;
  let aviso: AvisoPersonas | null = apertura.aviso;
  if (apertura.ctx) {
    try {
      lectura = await leerNomina(apertura.ctx);
    } catch (error) {
      aviso = errorDePersonas(error);
    }
  }
  const contenido = aviso ? <MaestroCerrado aviso={aviso} /> : apertura.ctx && lectura ? (
    <PantallaNomina lectura={lectura} hoy={hoyEnMexico(new Date())} empresaId={apertura.ctx.empresa?.id ?? ""} puedePreparar={puede(apertura.ctx, "cliente.pago.solicitar")} />
  ) : <MaestroCerrado aviso="libro" />;
  return <Marco actual="/consola/personas" vista={vistaDeMarco(apertura.ctxMarco)}><main id="contenido" className="consola personas-modulo">{contenido}</main></Marco>;
}
