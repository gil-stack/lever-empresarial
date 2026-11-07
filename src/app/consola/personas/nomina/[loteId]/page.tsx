import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { DetalleLoteNomina } from "@/components/personas/lote";
import { MaestroCerrado } from "@/components/personas/maestro";
import { leerLoteNomina } from "@/server/nomina";
import type { LecturaLote } from "@/server/nomina/tipos";

import { abrirPersonas, errorDePersonas, type AvisoPersonas } from "../../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Lote de nómina · Personas" };

export default async function PaginaLote({ params }: { params: Promise<{ loteId: string }> }) {
  const [apertura, { loteId }] = await Promise.all([abrirPersonas("/consola/personas/nomina/[loteId]"), params]);
  let lectura: LecturaLote | null = null;
  let aviso: AvisoPersonas | null = apertura.aviso;
  if (apertura.ctx) {
    try {
      lectura = await leerLoteNomina(apertura.ctx, loteId);
      if (!lectura) aviso = "ausente";
    } catch (error) {
      aviso = errorDePersonas(error);
    }
  }
  const contenido = aviso ? <MaestroCerrado aviso={aviso} /> : apertura.ctx && lectura ? (
    <DetalleLoteNomina lectura={lectura} empresaId={apertura.ctx.empresa?.id ?? ""} />
  ) : <MaestroCerrado aviso="libro" />;
  return <Marco actual="/consola/personas" vista={vistaDeMarco(apertura.ctxMarco)} titulo="Lote de nómina"><main id="contenido" className="consola personas-modulo">{contenido}</main></Marco>;
}
