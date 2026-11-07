import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { Resumen, type CargaResumen } from "@/components/inicio/resumen";
import { atajosDeInicio } from "@/dominio/inicio";
import { periodoResumen, type PeriodoResumen } from "@/dominio/resumen";
import { enEmpresa, rutaConsola } from "@/nucleo/rutas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerFlujoInicio } from "@/server/flujo/servicio";
import { leerResumenInicio } from "@/server/inicio/resumen-servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Inicio" };

type Busqueda = { periodo?: string; mover?: string; fecha?: string };

export default async function PaginaConsola({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const params = await searchParams;
  const periodo = periodoResumen(params.periodo);
  const apertura = await abrirRuta("/consola");
  if (apertura.tipo === "sin_permiso") notFound();
  // Marcadores viejos y /c/<empresa>: quien no ve cifras aterriza en Aprobaciones, no en un 404.
  if (apertura.tipo === "abierta" && rutaConsola(apertura.ctx.capacidades) !== "/consola") {
    redirect(enEmpresa(apertura.ctx.empresa?.id, "/consola/aprobaciones"));
  }
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const carga = await cargar(apertura, periodo, params);

  return (
    <Marco actual="/consola" vista={vistaDeMarco(ctx)}>
      <main id="contenido">
        <Resumen carga={carga} empresaId={ctx?.empresa?.id ?? null} atajos={ctx ? atajosDeInicio(ctx.capacidades) : []} />
      </main>
    </Marco>
  );
}

async function cargar(apertura: Awaited<ReturnType<typeof abrirRuta>>, periodo: PeriodoResumen, params: Busqueda): Promise<CargaResumen> {
  if (apertura.tipo === "libro") return { tipo: "error" };
  if (apertura.tipo === "sin_empresa") return { tipo: "sin_empresa" };
  try {
    // El escenario llega por la dirección y solo recalcula: no escribe nada.
    const pedido = params.mover === undefined ? {} : { mover: params.mover, fecha: params.fecha };
    // El libro de asientos solo se pinta en demostración, como «confirmado por el banco».
    const [flujo, libro] = await Promise.all([
      leerFlujoInicio(apertura.ctx, pedido),
      apertura.ctx.empresa?.demostracion ? leerResumenInicio(apertura.ctx, periodo) : Promise.resolve(null),
    ]);
    return { tipo: "lista", flujo, libro: libro?.tieneMovimientos ? libro : null };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return { tipo: "error" };
    throw error;
  }
}
