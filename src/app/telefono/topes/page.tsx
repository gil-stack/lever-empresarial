import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarcoTelefono } from "@/components/cromo/marco";
import { EstadoTelefono } from "@/components/telefono/estado";
import { Topes } from "@/components/telefono/topes";
import { puede } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerTopesTelefono } from "@/server/telefono/servicio";
import type { TopeTelefono } from "@/server/telefono/tipos";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Topes" };

export default async function PaginaTopes() {
  const apertura = await abrirRuta("/telefono/topes");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let carga: { tipo: "lista"; topes: TopeTelefono[] } | { tipo: "error" | "sin_empresa" };
  if (apertura.tipo === "libro") carga = { tipo: "error" };
  else if (apertura.tipo === "sin_empresa") carga = { tipo: "sin_empresa" };
  else {
    try {
      carga = { tipo: "lista", topes: await leerTopesTelefono(apertura.ctx) };
    } catch (error) {
      if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
      carga = { tipo: "error" };
    }
  }
  return (
    <MarcoTelefono titulo="Tus topes" actual="/telefono/topes" empresaId={ctx?.empresa?.id ?? null} personaId={ctx?.persona.id} consola={puede(ctx, "cliente.consola.ver")} resumen={puede(ctx, "cliente.resumen.ver")} variasEmpresas={Boolean(ctx && ctx.empresas.length > 1)}>
      {carga.tipo === "lista" ? <Topes topes={carga.topes} /> : <EstadoTelefono tipo={carga.tipo} />}
    </MarcoTelefono>
  );
}
