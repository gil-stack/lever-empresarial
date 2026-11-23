import type { Metadata } from "next";

import { filtroDe, TableroTarjetas } from "@/components/operacion/inventario-tarjetas";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { leerInventarioTarjetas } from "@/server/efevoo/inventario";
import { exigirContextoOperacion } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

import "@/estilo/inventario-tarjetas.css";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Tarjetas · Operación" };

export default async function TarjetasOperacion({ searchParams }: { searchParams: Parametros<"ver"> }) {
  const ctx = await exigirContextoOperacion();
  if (!puedeEnOperacion(ctx, "plataforma.empresa.alta")) {
    return (
      <PaginaOperacion titulo="Tarjetas">
        <SinPermiso>El inventario de tarjetas lo ve Administración de la plataforma.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const [inventario, params] = await Promise.all([leerInventarioTarjetas(ctx), soloTexto(searchParams)]);
  return (
    <PaginaOperacion titulo="Tarjetas">
      <TableroTarjetas inventario={inventario} filtro={filtroDe(params.ver)} />
    </PaginaOperacion>
  );
}
