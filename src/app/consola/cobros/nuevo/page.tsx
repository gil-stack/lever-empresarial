import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaNuevoPagina } from "@/components/cobranza/vistas";
import { leerVistaNuevo } from "@/server/cobranza/servicio";

import { abrirCobranza } from "../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Nuevo cliente · Cobranza" };

export default async function PaginaNuevoCliente() {
  const { ctx, vista } = await abrirCobranza("/consola/cobros/nuevo", (c) => leerVistaNuevo(c));
  return (
    <Marco actual="/consola/cobros" vista={vistaDeMarco(ctx)} titulo="Nuevo cliente">
      <main id="contenido" className="pagina">
        <VistaNuevoPagina vista={vista} empresaId={ctx?.empresa?.id ?? ""} />
      </main>
    </Marco>
  );
}
