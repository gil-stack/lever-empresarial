import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { ModuloDiseno } from "@/components/demo/modulo";
import { VistaDemo } from "@/components/demo/vista";
import { EnlacesFiscal } from "@/components/demo/vistas/fiscal";
import { puede } from "@/nucleo/contexto";
import { leerDemo } from "@/server/demo";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Fiscal" };

/**
 * Fiscal reúne la Lista 69-B y la Póliza (reales, con sus mismas puertas) y la
 * parte que todavía no existe (IVA, alertas y DIOT), que es demostración.
 */
export default async function PaginaFiscal() {
  const apertura = await abrirRuta("/consola/fiscal");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const abierta = apertura.tipo === "abierta" ? apertura.ctx : null;
  const carga = leerDemo(abierta, "fiscal");
  const enlaces = {
    lista69b: abierta ? puede(abierta, "cliente.lista69b.ver") || puede(abierta, "plataforma.lista69b.cargar") : false,
    poliza: abierta ? puede(abierta, "cliente.poliza.ver") : false,
  };
  return (
    <Marco actual="/consola/fiscal" vista={vistaDeMarco(ctx)}>
      <ModuloDiseno titulo="Fiscal">
        <EnlacesFiscal empresaId={ctx?.empresa?.id ?? null} enlaces={enlaces} />
        <VistaDemo carga={carga} empresaId={ctx?.empresa?.id ?? null} />
      </ModuloDiseno>
    </Marco>
  );
}
