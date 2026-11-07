import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaPresupuestosPagina } from "@/components/flujo/vistas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerVistaPresupuestos, type VistaPresupuestos } from "@/server/flujo/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Presupuestos" };

export default async function PaginaPresupuestos() {
  const apertura = await abrirRuta("/consola/presupuestos");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let vista: VistaPresupuestos | null = null;
  if (apertura.tipo === "abierta") {
    try {
      vista = await leerVistaPresupuestos(apertura.ctx);
    } catch (error) {
      if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
    }
  }
  return (
    <Marco actual="/consola/presupuestos" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <VistaPresupuestosPagina vista={vista} empresaId={ctx?.empresa?.id ?? null} />
      </main>
    </Marco>
  );
}
