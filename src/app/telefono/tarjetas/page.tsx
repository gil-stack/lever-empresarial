import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarcoTelefono } from "@/components/cromo/marco";
import { EstadoTelefono } from "@/components/telefono/estado";
import { TarjetasTitular } from "@/components/telefono/tarjetas";
import { puede } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";
import { leerMisTarjetas, type TarjetaDelTitular } from "@/server/tarjetas";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Tus tarjetas" };

/** El titular ve solo sus tarjetas (lo impone la base), con saldo y movimientos, sin operar. */
export default async function PaginaTarjetasTelefono() {
  const apertura = await abrirRuta("/telefono/tarjetas");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let carga: { tipo: "lista"; tarjetas: readonly TarjetaDelTitular[] | null } | { tipo: "error" | "sin_empresa" };
  if (apertura.tipo === "libro") carga = { tipo: "error" };
  else if (apertura.tipo === "sin_empresa") carga = { tipo: "sin_empresa" };
  else {
    try {
      carga = { tipo: "lista", tarjetas: await leerMisTarjetas(apertura.ctx) };
    } catch (error) {
      if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
      carga = { tipo: "error" };
    }
  }
  return (
    <MarcoTelefono titulo="Tus tarjetas" actual="/telefono/tarjetas" empresaId={ctx?.empresa?.id ?? null} personaId={ctx?.persona.id} consola={puede(ctx, "cliente.consola.ver")} resumen={puede(ctx, "cliente.resumen.ver")} variasEmpresas={Boolean(ctx && ctx.empresas.length > 1)}>
      {carga.tipo === "lista" ? <TarjetasTitular tarjetas={carga.tarjetas} /> : <EstadoTelefono tipo={carga.tipo} />}
    </MarcoTelefono>
  );
}
