import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaClientePagina } from "@/components/cobranza/vistas";
import { leerVistaCliente } from "@/server/cobranza/servicio";

import { abrirCobranza } from "../../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Cliente · Cobranza" };

export default async function PaginaCliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ alta?: string }> }) {
  const [{ id }, { alta }] = await Promise.all([params, searchParams]);
  // Un cliente que no es de esta empresa (o que no existe) es 404, igual que una ruta ajena.
  const { ctx, vista } = await abrirCobranza("/consola/cobros/clientes/[id]", async (c) => (await leerVistaCliente(c, id)) ?? notFound());
  return (
    <Marco actual="/consola/cobros" vista={vistaDeMarco(ctx)} titulo={vista?.detalle.cliente.nombre ?? "Cobranza"}>
      <main id="contenido" className="pagina">
        <VistaClientePagina vista={vista} empresaId={ctx?.empresa?.id ?? ""} alta={typeof alta === "string" ? alta : undefined} />
      </main>
    </Marco>
  );
}
