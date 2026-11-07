import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { PanelLista69b } from "@/components/lista-69b/panel";
import { CabezaPagina } from "@/components/sistema";
import { puede, type ContextoDeTenant } from "@/nucleo/contexto";
import { abrirRuta } from "@/server/entrada";
import { leerVista69b, type VistaLista69b } from "@/server/lista-69b";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Lista 69-B",
};

type Carga =
  | { tipo: "sin_empresa" }
  | { tipo: "sin_permiso" }
  | { tipo: "aviso"; mensaje: string }
  | { tipo: "lista"; vista: VistaLista69b };

export default async function PaginaLista69b({
  searchParams,
}: {
  searchParams: Promise<{ rfc?: string | string[] }>;
}) {
  const params = await searchParams;
  const rfc = typeof params.rfc === "string" ? params.rfc : null;
  const apertura = await abrirRuta("/consola/lista-69b");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const carga =
    apertura.tipo === "libro"
      ? ({ tipo: "aviso", mensaje: "No se pudo consultar el listado." } as const)
      : apertura.tipo === "sin_permiso"
        ? ({ tipo: "sin_permiso" } as const)
        : apertura.tipo !== "abierta" || !ctx
          ? ({ tipo: "sin_empresa" } as const)
          : await cargar(ctx, rfc);

  return (
    <Marco actual="/consola/lista-69b" vista={vistaDeMarco(ctx)} titulo="Lista 69-B">
      <main id="contenido" className="pagina">
        {carga.tipo === "lista" ? (
          <>
            <h1 className="solo-lector">Listado del artículo 69-B</h1>
            <PanelLista69b vista={carga.vista} />
          </>
        ) : (
          <CabezaPagina kicker="Lista 69-B" titulo={titulo(carga)}>
            <p className="lede">{detalle(carga)}</p>
          </CabezaPagina>
        )}
      </main>
    </Marco>
  );
}

async function cargar(ctx: ContextoDeTenant, rfc: string | null): Promise<Carga> {
  try {
    if (!puede(ctx, "cliente.lista69b.ver") && !puede(ctx, "plataforma.lista69b.cargar")) {
      return { tipo: "sin_permiso" };
    }
    return { tipo: "lista", vista: await leerVista69b(ctx, rfc) };
  } catch (error) {
    if (error instanceof ErrorDeDominio) return { tipo: "aviso", mensaje: "No se pudo consultar el listado." };
    throw error;
  }
}

function titulo(carga: Exclude<Carga, { tipo: "lista" }>): string {
  if (carga.tipo === "sin_empresa") return "Elige una empresa.";
  if (carga.tipo === "sin_permiso") return "Tu rol no abre la lista 69-B.";
  return "No se pudo consultar el listado.";
}

function detalle(carga: Exclude<Carga, { tipo: "lista" }>): string {
  if (carga.tipo === "sin_empresa") return "La lista se consulta dentro de una empresa.";
  if (carga.tipo === "sin_permiso") return "Pide acceso a quien administra la empresa.";
  return carga.mensaje;
}
