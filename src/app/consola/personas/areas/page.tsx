import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { AreasPersonas } from "@/components/personas/areas";
import { MaestroCerrado } from "@/components/personas/maestro";
import { puede } from "@/nucleo/contexto";
import { leerMaestro } from "@/server/personas";
import type { LecturaMaestro } from "@/server/personas/tipos";

import { abrirPersonas, errorDePersonas, type AvisoPersonas } from "../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Áreas y presupuestos · Personas" };

export default async function PaginaAreas() {
  const apertura = await abrirPersonas("/consola/personas/areas");
  let lectura: LecturaMaestro | null = null;
  let aviso: AvisoPersonas | null = apertura.aviso;
  if (apertura.ctx) {
    try {
      lectura = await leerMaestro(apertura.ctx);
    } catch (error) {
      aviso = errorDePersonas(error);
    }
  }
  const contenido = aviso ? <MaestroCerrado aviso={aviso} /> : apertura.ctx && lectura ? (
    <AreasPersonas lectura={lectura} empresaId={apertura.ctx.empresa?.id ?? ""} edita={puede(apertura.ctx, "cliente.maestro.editar")} />
  ) : <MaestroCerrado aviso="libro" />;
  return <Marco actual="/consola/personas" vista={vistaDeMarco(apertura.ctxMarco)}><main id="contenido" className="consola personas-modulo">{contenido}</main></Marco>;
}
