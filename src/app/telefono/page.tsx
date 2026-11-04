import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarcoTelefono } from "@/components/cromo/marco";
import { EstadoTelefono } from "@/components/telefono/estado";
import { Inicio } from "@/components/telefono/inicio";
import { puede } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerInicioTelefono } from "@/server/telefono/servicio";
import type { InicioTelefono } from "@/server/telefono/tipos";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Inicio" };

export default async function PaginaTelefono() {
  const apertura = await abrirRuta("/telefono");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let carga: { tipo: "lista"; persona: InicioTelefono } | { tipo: "error" | "sin_empresa" };
  if (apertura.tipo === "libro") carga = { tipo: "error" };
  else if (apertura.tipo === "sin_empresa") carga = { tipo: "sin_empresa" };
  else {
    try {
      carga = { tipo: "lista", persona: await leerInicioTelefono(apertura.ctx) };
    } catch (error) {
      if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
      carga = { tipo: "error" };
    }
  }
  return (
    <MarcoTelefono
      actual="/telefono"
      empresaId={ctx?.empresa?.id ?? null}
      consola={puede(ctx, "cliente.consola.ver")}
      variasEmpresas={Boolean(ctx && ctx.empresas.length > 1)}
    >
      {carga.tipo === "lista" ? (
        ctx?.empresa ? <Inicio persona={carga.persona} empresa={ctx.empresa.razonSocial} /> : <EstadoTelefono tipo="error" />
      ) : <EstadoTelefono tipo={carga.tipo} />}
    </MarcoTelefono>
  );
}
