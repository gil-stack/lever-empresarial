import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DetalleDeTarjeta } from "@/components/operacion/detalle-tarjeta";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { leerDetalleTarjeta } from "@/server/efevoo/detalle-tarjeta";
import { exigirContextoOperacion } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

import "@/estilo/inventario-tarjetas.css";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Tarjeta · Operación" };

export default async function TarjetaOperacion({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirContextoOperacion();
  const volver = <Link className="boton-texto" href="/operacion/tarjetas">← Tarjetas</Link>;
  if (!puedeEnOperacion(ctx, "plataforma.empresa.alta")) {
    return (
      <PaginaOperacion titulo="Tarjeta" accion={volver}>
        <SinPermiso>El detalle de las tarjetas lo ve Administración de la plataforma.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const { id } = await params;
  const detalle = await leerDetalleTarjeta(ctx, id);
  if (!detalle) notFound();
  return (
    <PaginaOperacion titulo={`Tarjeta •••• ${detalle.tarjeta.terminacion}`} accion={volver}>
      <DetalleDeTarjeta detalle={detalle} />
    </PaginaOperacion>
  );
}
