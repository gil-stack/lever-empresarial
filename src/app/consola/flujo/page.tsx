import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaFlujo } from "@/components/flujo/vistas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerVistaSaldo, type VistaSaldo } from "@/server/flujo/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Saldo y alertas" };

export default async function PaginaFlujo() {
  const apertura = await abrirRuta("/consola/flujo");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let vista: VistaSaldo | null = null;
  if (apertura.tipo === "abierta") {
    try {
      vista = await leerVistaSaldo(apertura.ctx);
    } catch (error) {
      if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
    }
  }
  return (
    <Marco actual="/consola/flujo" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <VistaFlujo vista={vista} />
      </main>
    </Marco>
  );
}
