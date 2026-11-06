import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaCobrosPagina } from "@/components/flujo/vistas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerVistaCobros, type VistaCobros } from "@/server/flujo/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Cobros esperados" };

export default async function PaginaCobros({ searchParams }: { searchParams: Promise<{ estado?: string; vence?: string }> }) {
  const params = await searchParams;
  const apertura = await abrirRuta("/consola/cobros");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let vista: VistaCobros | null = null;
  if (apertura.tipo === "abierta") {
    try {
      vista = await leerVistaCobros(apertura.ctx);
    } catch (error) {
      if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
    }
  }
  return (
    <Marco actual="/consola/cobros" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <VistaCobrosPagina vista={vista} empresaId={ctx?.empresa?.id ?? null} estado={params.estado} vence={params.vence} />
      </main>
    </Marco>
  );
}
