import type { Metadata } from "next";

import { DecisionesOperacion } from "@/components/operacion/decisiones";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { NotaRegla } from "@/components/sistema";
import { exigirContextoOperacion, listarComisiones, listarSolicitudesActivacion } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Aprobaciones · Operación" };

export default async function AprobacionesOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [solicitudes, versiones, params] = await Promise.all([listarSolicitudesActivacion(ctx), listarComisiones(ctx), searchParams]);
  const comisiones = versiones.filter((version) => version.estado === "pendiente");
  return (
    <PaginaOperacion titulo="Aprobaciones" aviso={params.aviso}>
      <DecisionesOperacion solicitudes={solicitudes} comisiones={comisiones} personaId={ctx.persona.id} />
      <NotaRegla>Para decidir, tu segundo factor debe ser de los últimos 30 minutos.</NotaRegla>
    </PaginaOperacion>
  );
}
