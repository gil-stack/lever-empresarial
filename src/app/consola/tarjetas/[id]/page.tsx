import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { ModuloDiseno } from "@/components/demo/modulo";
import { VistaDetalleTarjeta } from "@/components/tarjetas/detalle";
import { puede } from "@/nucleo/contexto";
import { abrirRuta } from "@/server/entrada";
import { leerDetalleTarjeta } from "@/server/tarjetas";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Tarjeta" };

/** Una tarjeta de la empresa con sus movimientos en el emisor. Una tarjeta de otra empresa (o que no existe) es 404. */
export default async function PaginaTarjeta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apertura = await abrirRuta("/consola/tarjetas/[id]");
  if (apertura.tipo !== "abierta") notFound();
  const detalle = await leerDetalleTarjeta(apertura.ctx, id);
  if (!detalle) notFound();
  return (
    <Marco actual="/consola/tarjetas" vista={vistaDeMarco(apertura.ctx)}>
      <ModuloDiseno titulo="Tarjetas">
        <VistaDetalleTarjeta detalle={detalle} empresaId={apertura.ctx.empresa?.id ?? null} puedeOperar={puede(apertura.ctx, "cliente.tarjetas.operar")} />
      </ModuloDiseno>
    </Marco>
  );
}
