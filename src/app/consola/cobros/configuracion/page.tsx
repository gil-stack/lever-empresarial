import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaConfiguracionPagina } from "@/components/cobranza/vistas";
import { leerVistaConfiguracion } from "@/server/cobranza/servicio";

import { abrirCobranza } from "../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Configuración · Cobranza" };

export default async function PaginaConfiguracionCobranza() {
  const { ctx, vista } = await abrirCobranza("/consola/cobros/configuracion", (c) => leerVistaConfiguracion(c));
  return (
    <Marco actual="/consola/cobros" vista={vistaDeMarco(ctx)} titulo="Configuración de cobranza">
      <main id="contenido" className="pagina">
        <VistaConfiguracionPagina vista={vista} empresaId={ctx?.empresa?.id ?? ""} />
      </main>
    </Marco>
  );
}
