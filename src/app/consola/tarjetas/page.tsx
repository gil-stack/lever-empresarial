import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { ModuloDiseno } from "@/components/demo/modulo";
import { VistaDemo } from "@/components/demo/vista";
import { VistaTarjetasEfevoo } from "@/components/tarjetas/vista";
import { puede } from "@/nucleo/contexto";
import { leerDemo } from "@/server/demo";
import { abrirRuta } from "@/server/entrada";
import { leerTarjetasEmpresa } from "@/server/tarjetas";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Tarjetas" };

/**
 * Con la empresa vinculada a Efevoo Pay, sus tarjetas reales. Sin vínculo o sin configuración, como los demás módulos
 * en demostración: datos de ejemplo en empresas de demostración y «Disponible pronto» en las reales.
 */
export default async function PaginaTarjetas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const apertura = await abrirRuta("/consola/tarjetas");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const reales = apertura.tipo === "abierta" && ctx?.empresa && !ctx.empresa.demostracion ? await leerTarjetasEmpresa(ctx) : null;
  return (
    <Marco actual="/consola/tarjetas" vista={vistaDeMarco(ctx)}>
      <ModuloDiseno titulo="Tarjetas">
        {reales ? (
          <VistaTarjetasEfevoo datos={reales} empresaId={ctx?.empresa?.id ?? null} puedeOperar={puede(ctx, "cliente.tarjetas.operar")} ahora={new Date()} />
        ) : (
          <VistaDemo carga={leerDemo(apertura.tipo === "abierta" ? ctx : null, "tarjetas")} empresaId={ctx?.empresa?.id ?? null} params={params} />
        )}
      </ModuloDiseno>
    </Marco>
  );
}
