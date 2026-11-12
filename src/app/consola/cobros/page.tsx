import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { VistaCobranzaPagina } from "@/components/cobranza/vistas";
import { enEmpresa } from "@/nucleo/rutas";
import { leerFiltros, leerVistaCobranza } from "@/server/cobranza/servicio";

import { abrirCobranza } from "./apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Cobranza" };

const PESTANAS = ["cargos", "clientes", "conciliar"] as const;

export default async function PaginaCobranza({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filtros = leerFiltros(params);
  const pestana = PESTANAS.find((p) => p === params.vista) ?? "cargos";
  const { ctx, vista } = await abrirCobranza("/consola/cobros", (c) => leerVistaCobranza(c, filtros));
  const empresaId = ctx?.empresa?.id ?? "";
  return (
    <Marco
      actual="/consola/cobros"
      vista={vistaDeMarco(ctx)}
      titulo="Cobranza"
      accion={vista?.puedeEditar && vista.configuracion ? <Link className="boton" href={enEmpresa(empresaId, "/consola/cobros/nuevo")}>Nuevo cliente</Link> : null}
    >
      <main id="contenido" className="pagina">
        <VistaCobranzaPagina vista={vista} empresaId={empresaId} pestana={pestana} />
      </main>
    </Marco>
  );
}
