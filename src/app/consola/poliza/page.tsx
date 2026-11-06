import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { CabezaPagina, Vacio } from "@/components/sistema";
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
    <Marco actual="/consola/poliza" vista={vistaDeMarco(ctx)} titulo="Póliza">
      <main id="contenido" className="consola">
        {carga.tipo === "abierta" ? (
          <>
            <h1 className="solo-lector">Póliza contable</h1>
            <section className="panel" aria-labelledby="polizas-titulo">
              <div className="panel-cabeza">
                <h2 id="polizas-titulo">Pólizas para tu contador</h2>
                <small>Solo lectura</small>
              </div>
              <Vacio titulo="Todavía no hay pólizas para exportar">
                Se arman con los expedientes cerrados y esta empresa todavía no tiene ninguno. Las consultan quien
                administra y el contador.
              </Vacio>
            </section>
          </>
        ) : (
          <CabezaPagina kicker="Póliza" titulo={titulo(carga)}>
            <p className="lede">{detalle(carga)}</p>
          </CabezaPagina>
        )}
      </main>
    </Marco>
  );
}

async function cargar(
  tipo: Awaited<ReturnType<typeof abrirRuta>>["tipo"],
  ctx: Awaited<ReturnType<typeof abrirRuta>> extends infer A ? (A extends { ctx: infer C } ? C : null) : null,
): Promise<Carga> {
  if (tipo === "libro") return { tipo: "aviso", mensaje: "No se pudo abrir la póliza." };
  if (tipo === "sin_empresa") return { tipo: "aviso", mensaje: "La póliza se abre dentro de una empresa." };
  if (tipo === "sin_permiso" || !ctx) return { tipo: "ajena" };
  try {
    await entrarAPoliza(ctx);
    return { tipo: "abierta" };
  } catch (error) {
    if (!(error instanceof ErrorDeDominio)) throw error;
    if (error.codigo === "sin_entrada_a_poliza" || error.codigo === "sin_membresia") return { tipo: "ajena" };
    if (error.codigo === "sin_empresa") return { tipo: "aviso", mensaje: "La póliza se abre dentro de una empresa." };
    return { tipo: "aviso", mensaje: "No se pudo abrir la póliza." };
  }
}

function titulo(carga: Exclude<Carga, { tipo: "abierta" }>): string {
  if (carga.tipo === "ajena") return "Tu rol no abre la póliza.";
  return "No se pudo abrir la póliza.";
}

function detalle(carga: Exclude<Carga, { tipo: "abierta" }>): string {
  if (carga.tipo === "ajena") return "La consultan quien administra la empresa y el contador.";
  return carga.mensaje;
}
