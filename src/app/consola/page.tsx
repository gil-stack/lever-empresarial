import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { Resumen, type CargaResumen } from "@/components/inicio/resumen";
import { atajosDeInicio } from "@/dominio/inicio";
import { periodoResumen, type PeriodoResumen } from "@/dominio/resumen";
import { enEmpresa, rutaConsola } from "@/nucleo/rutas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerResumenInicio } from "@/server/inicio/resumen-servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Inicio" };

export default async function PaginaConsola({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const params = await searchParams;
  const periodo = periodoResumen(params.periodo);
  const apertura = await abrirRuta("/consola");
  if (apertura.tipo === "sin_permiso") notFound();
  // Marcadores viejos y /c/<empresa>: quien no ve cifras aterriza en Pendientes, no en un 404.
  if (apertura.tipo === "abierta" && rutaConsola(apertura.ctx.capacidades) !== "/consola") {
    redirect(enEmpresa(apertura.ctx.empresa?.id, "/consola/pendientes"));
  }
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const carga = await cargar(apertura, periodo);

  return (
    <Marco actual="/consola" vista={vistaDeMarco(ctx)}>
      <main id="contenido">
        <Resumen carga={carga} empresaId={ctx?.empresa?.id ?? null} nombre={ctx?.persona.nombre ?? ""} atajos={ctx ? atajosDeInicio(ctx.capacidades) : []} />
      </main>
    </Marco>
  );
}

async function cargar(apertura: Awaited<ReturnType<typeof abrirRuta>>, periodo: PeriodoResumen): Promise<CargaResumen> {
  if (apertura.tipo === "libro") return { tipo: "error" };
  if (apertura.tipo === "sin_empresa") return { tipo: "sin_empresa" };
  try {
    return { tipo: "lista", resumen: await leerResumenInicio(apertura.ctx, periodo) };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return { tipo: "error" };
    throw error;
  }
}
