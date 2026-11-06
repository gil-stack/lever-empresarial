import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaCalendarioPagina } from "@/components/flujo/vistas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerVistaCalendario, type VistaCalendario } from "@/server/flujo/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Calendario de obligaciones" };

export default async function PaginaCalendario({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const params = await searchParams;
  const apertura = await abrirRuta("/consola/calendario");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let vista: VistaCalendario | null = null;
  if (apertura.tipo === "abierta") {
    try {
      vista = await leerVistaCalendario(apertura.ctx, params.mes);
    } catch (error) {
      if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
    }
  }
  return (
    <Marco actual="/consola/calendario" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <VistaCalendarioPagina vista={vista} empresaId={ctx?.empresa?.id ?? null} />
      </main>
    </Marco>
  );
}
