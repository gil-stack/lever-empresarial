import type { Metadata } from "next";

import { DetalleDeTarjeta } from "@/components/operacion/detalle-tarjeta";
import { TableroTarjetas } from "@/components/operacion/inventario-tarjetas";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { VentanaDeTarjeta } from "@/components/operacion/ventana-tarjeta";
import { Vacio } from "@/components/sistema";
import { empresaDe, enlaceTarjetas, estadoDe, paginaDe, textoDeBusqueda } from "@/dominio/tarjetas/inventario";
import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { idDeTarjeta, leerDetalleTarjeta } from "@/server/efevoo/detalle-tarjeta";
import { leerTarjetas } from "@/server/efevoo/inventario";
import { exigirContextoOperacion } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

import "@/estilo/inventario-tarjetas.css";

export const runtime = "nodejs";
// La primera lectura del inventario del procesador puede tardar; las siguientes van en segundo plano.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Tarjetas · Operación" };

export default async function TarjetasOperacion({ searchParams }: { searchParams: Parametros<"q" | "estado" | "empresa" | "pagina" | "tarjeta"> }) {
  const ctx = await exigirContextoOperacion();
  if (!puedeEnOperacion(ctx, "plataforma.empresa.alta")) {
    return (
      <PaginaOperacion titulo="Tarjetas">
        <SinPermiso>El inventario de tarjetas lo ve Administración de la plataforma.</SinPermiso>
      </PaginaOperacion>
    );
  }
  const params = await soloTexto(searchParams);
  const filtro = { q: textoDeBusqueda(params.q), estado: estadoDe(params.estado), empresa: empresaDe(params.empresa), pagina: paginaDe(params.pagina) };
  const idTarjeta = params.tarjeta === undefined ? null : idDeTarjeta(params.tarjeta);
  const vista = await leerTarjetas(ctx, filtro);
  const detalle = params.tarjeta === undefined ? undefined : await leerDetalleTarjeta(ctx, params.tarjeta);
  const cerrarEn = enlaceTarjetas(filtro);
  return (
    <PaginaOperacion titulo="Tarjetas">
      <TableroTarjetas vista={vista} ahora={new Date()} />
      {detalle === undefined ? null : detalle ? (
        <VentanaDeTarjeta
          key={detalle.tarjeta.id}
          titulo={`Tarjeta •••• ${detalle.tarjeta.terminacion}`}
          contexto={detalle.ambiente === "sandbox" ? "Solo consulta · ambiente de pruebas" : "Solo consulta"}
          cerrarEn={cerrarEn}
        >
          <DetalleDeTarjeta detalle={detalle} />
        </VentanaDeTarjeta>
      ) : (
        <VentanaDeTarjeta key={`no-${idTarjeta ?? "x"}`} titulo="Tarjeta no encontrada" cerrarEn={cerrarEn}>
          <Vacio titulo="No encontramos esa tarjeta">Puede que el enlace esté incompleto o que la tarjeta ya no esté en el inventario.</Vacio>
        </VentanaDeTarjeta>
      )}
    </PaginaOperacion>
  );
}
