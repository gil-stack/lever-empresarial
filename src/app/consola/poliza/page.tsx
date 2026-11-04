import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { CabezaPagina } from "@/components/sistema";
import { abrirRuta } from "@/server/entrada";
import { entrarAPoliza } from "@/server/roles/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Póliza",
};

type Carga = { tipo: "abierta" } | { tipo: "ajena" } | { tipo: "aviso"; mensaje: string };

export default async function PaginaPoliza() {
  const apertura = await abrirRuta("/consola/poliza");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const carga = await cargar(apertura.tipo, ctx);

  return (
    <Marco actual="/consola/poliza" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="consola">
        <CabezaPagina kicker="Póliza" titulo={titulo(carga)}>
          <p className="lede">{detalle(carga)}</p>
        </CabezaPagina>
      </main>
    </Marco>
  );
}

async function cargar(
  tipo: Awaited<ReturnType<typeof abrirRuta>>["tipo"],
  ctx: Awaited<ReturnType<typeof abrirRuta>> extends infer A ? (A extends { ctx: infer C } ? C : null) : null,
): Promise<Carga> {
  if (tipo === "libro") return { tipo: "aviso", mensaje: "No se pudo abrir la póliza." };
  if (tipo === "sin_empresa") return { tipo: "aviso", mensaje: "La póliza nace con la cuenta." };
  if (tipo === "sin_permiso" || !ctx) return { tipo: "ajena" };
  try {
    await entrarAPoliza(ctx);
    return { tipo: "abierta" };
  } catch (error) {
    if (!(error instanceof ErrorDeDominio)) throw error;
    if (error.codigo === "sin_entrada_a_poliza" || error.codigo === "sin_membresia") return { tipo: "ajena" };
    if (error.codigo === "sin_empresa") return { tipo: "aviso", mensaje: "La póliza nace con la cuenta." };
    return { tipo: "aviso", mensaje: "No se pudo abrir la póliza." };
  }
}

function titulo(carga: Carga): string {
  if (carga.tipo === "abierta") return "Entrada del contador.";
  if (carga.tipo === "ajena") return "Esta entrada es del contador.";
  return "No se pudo abrir la póliza.";
}

function detalle(carga: Carga): string {
  if (carga.tipo === "abierta") {
    return "Desde aquí se exporta la póliza. No se suelta dinero. En este corte no hay archivo: todavía no hay expedientes que cerrar.";
  }
  if (carga.tipo === "ajena") return "Quien administra y quien libera no entran por esta puerta.";
  return carga.mensaje;
}
