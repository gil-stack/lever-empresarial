import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { ExpedientePersona } from "@/components/personas/detalle";
import { MaestroCerrado } from "@/components/personas/maestro";
import { hoyEnMexico } from "@/dominio/personas";
import { puede } from "@/nucleo/contexto";
import { leerDetallePersona } from "@/server/personas";
import type { DetallePersona } from "@/server/personas/tipos";

import { abrirPersonas, errorDePersonas, type AvisoPersonas } from "../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Expediente · Personas" };

export default async function PaginaExpediente({ params }: { params: Promise<{ id: string }> }) {
  const [apertura, { id }] = await Promise.all([abrirPersonas("/consola/personas/[id]"), params]);
  let detalle: DetallePersona | null = null;
  let aviso: AvisoPersonas | null = apertura.aviso;
  if (apertura.ctx) {
    try {
      detalle = await leerDetallePersona(apertura.ctx, id);
      if (!detalle) aviso = "ausente";
    } catch (error) {
      aviso = errorDePersonas(error);
    }
  }
  const contenido = aviso ? <MaestroCerrado aviso={aviso} /> : apertura.ctx && detalle ? (
    <ExpedientePersona
      detalle={detalle}
      hoy={hoyEnMexico(new Date())}
      empresaId={apertura.ctx.empresa?.id ?? ""}
      edita={puede(apertura.ctx, "cliente.maestro.editar")}
      cambiaClabe={puede(apertura.ctx, "cliente.personas.clabe.cambiar")}
    />
  ) : <MaestroCerrado aviso="libro" />;
  return <Marco actual="/consola/personas" vista={vistaDeMarco(apertura.ctxMarco)}><main id="contenido" className="consola personas-modulo">{contenido}</main></Marco>;
}
