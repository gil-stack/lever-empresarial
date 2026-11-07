import type { Metadata } from "next";

import { DecisionesOperacion } from "@/components/operacion/decisiones";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { NotaRegla } from "@/components/sistema";
import {
  exigirContextoOperacion,
  listarComisiones,
  listarSolicitudesActivacion,
  listarSuspensionesPendientes,
  puedeEnOperacion,
} from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Aprobaciones · Operación" };

export default async function AprobacionesOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [solicitudes, versiones, suspensiones, params] = await Promise.all([
    listarSolicitudesActivacion(ctx),
    listarComisiones(ctx),
    listarSuspensionesPendientes(ctx),
    searchParams,
  ]);
  const comisiones = versiones.filter((version) => version.estado === "pendiente");
  const decide = {
    activaciones: puedeEnOperacion(ctx, "plataforma.activacion.aprobar"),
    comisiones: puedeEnOperacion(ctx, "plataforma.empresa.alta"),
    suspensiones: puedeEnOperacion(ctx, "plataforma.suspension.aprobar"),
  };
  return (
    <PaginaOperacion titulo="Aprobaciones" aviso={params.aviso}>
      <DecisionesOperacion solicitudes={solicitudes} comisiones={comisiones} suspensiones={suspensiones} personaId={ctx.persona.id} decide={decide} />
      <NotaRegla>
        Para decidir, tu segundo factor debe ser de los últimos 30 minutos. Quien pide nunca decide: activar, suspender y reactivar
        llevan dos firmas de personas distintas.
      </NotaRegla>
    </PaginaOperacion>
  );
}
