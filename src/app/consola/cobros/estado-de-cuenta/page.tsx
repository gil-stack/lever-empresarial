import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaEstadoDeCuentaPagina } from "@/components/cobranza/vistas";
import { leerVistaEstadoDeCuenta } from "@/server/cobranza/estado-cuenta";

import { abrirCobranza } from "../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Estado de cuenta · Cobranza" };

type Parametros = { importacion?: string; nuevos?: string; repetidos?: string };

export default async function PaginaEstadoDeCuenta({ searchParams }: { searchParams: Promise<Parametros> }) {
  const params = await searchParams;
  const { ctx, vista } = await abrirCobranza("/consola/cobros/estado-de-cuenta", (c) => leerVistaEstadoDeCuenta(c, params.importacion ?? null));
  const numero = (v: unknown) => (typeof v === "string" && /^\d{1,5}$/.test(v) ? v : undefined);
  return (
    <Marco actual="/consola/cobros" vista={vistaDeMarco(ctx)} titulo="Estado de cuenta">
      <main id="contenido" className="pagina">
        <VistaEstadoDeCuentaPagina vista={vista} empresaId={ctx?.empresa?.id ?? ""} nuevos={numero(params.nuevos)} repetidos={numero(params.repetidos)} />
      </main>
    </Marco>
  );
}
