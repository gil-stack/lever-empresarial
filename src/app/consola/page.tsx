import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { Pendientes, type CargaInicio } from "@/components/inicio/pendientes";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerPendientesInicio } from "@/server/inicio/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Pendientes" };

export default async function PaginaConsola() {
  const apertura = await abrirRuta("/consola");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const carga = await cargar(apertura);

  return (
    <Marco actual="/consola" vista={vistaDeMarco(ctx)}>
      <main id="contenido">
        <Pendientes carga={carga} empresaId={ctx?.empresa?.id ?? null} />
      </main>
    </Marco>
  );
}

async function cargar(apertura: Awaited<ReturnType<typeof abrirRuta>>): Promise<CargaInicio> {
  if (apertura.tipo === "libro") return { tipo: "error" };
  if (apertura.tipo === "sin_empresa") return { tipo: "sin_empresa" };
  try {
    return { tipo: "lista", pendientes: await leerPendientesInicio(apertura.ctx) };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return { tipo: "error" };
    throw error;
  }
}
