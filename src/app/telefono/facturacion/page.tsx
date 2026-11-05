import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarcoTelefono } from "@/components/cromo/marco";
import { EstadoTelefono } from "@/components/telefono/estado";
import { Facturacion } from "@/components/telefono/facturacion";
import { puede } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { qrDeDatosFiscales } from "@/server/telefono/datos";
import { leerFacturacionTelefono } from "@/server/telefono/servicio";
import type { DatosFiscalesTelefono } from "@/server/telefono/tipos";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Facturación" };

export default async function PaginaFacturacion() {
  const apertura = await abrirRuta("/telefono/facturacion");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let carga: { tipo: "lista"; datos: DatosFiscalesTelefono; qr: string | null } | { tipo: "error" | "sin_empresa" };
  if (apertura.tipo === "libro") carga = { tipo: "error" };
  else if (apertura.tipo === "sin_empresa") carga = { tipo: "sin_empresa" };
  else {
    try {
      const datos = await leerFacturacionTelefono(apertura.ctx);
      if (!datos) carga = { tipo: "error" };
      else {
        let qr: string | null = null;
        try {
          qr = await qrDeDatosFiscales(datos);
        } catch (error) {
          if (!(error instanceof ErrorDeDominio && error.codigo === "qr_no_disponible")) throw error;
        }
        carga = { tipo: "lista", datos, qr };
      }
    } catch (error) {
      if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
      carga = { tipo: "error" };
    }
  }
  return (
    <MarcoTelefono actual="/telefono/facturacion" empresaId={ctx?.empresa?.id ?? null} consola={puede(ctx, "cliente.consola.ver")} resumen={puede(ctx, "cliente.resumen.ver")} variasEmpresas={Boolean(ctx && ctx.empresas.length > 1)}>
      {carga.tipo === "lista" ? <Facturacion datos={carga.datos} qr={carga.qr} /> : <EstadoTelefono tipo={carga.tipo} />}
    </MarcoTelefono>
  );
}
