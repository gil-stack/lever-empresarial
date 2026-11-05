import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { MesaProveedores, type VistaProveedores } from "@/components/proveedores/mesa";
import { CabezaPagina } from "@/components/sistema";
import { fechaEnMexico } from "@/dominio/pagos-proveedores";
import { puede, type ContextoConEmpresa } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerPagosProveedores } from "@/server/pagos-proveedores";
import { leerClabesProveedor } from "@/server/proveedores";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Pagos a proveedores" };

type Params = { vista?: string; q?: string; estado?: string; pagina?: string; pago?: string; proveedor?: string };

export default async function PaginaProveedores({ searchParams }: { searchParams: Promise<Params> }) {
  const apertura = await abrirRuta("/consola/proveedores");
  const params = await searchParams;
  if (apertura.tipo !== "abierta" || !apertura.ctx.empresa) {
    return <Marco actual="/consola/proveedores" vista={vistaDeMarco(apertura.tipo === "libro" ? null : apertura.ctx)}><main id="contenido" className="pagina"><Cerrada tipo={apertura.tipo} /></main></Marco>;
  }
  const ctx = apertura.ctx as ContextoConEmpresa;
  const vista: VistaProveedores = params.vista === "proveedores" || params.vista === "agenda" ? params.vista : "pagos";
  let carga: Awaited<ReturnType<typeof cargar>> | null = null;
  try {
    carga = await cargar(ctx, params, vista);
  } catch (error) {
    if (!(error instanceof ErrorDeDominio) && !errorConSecreto(error)) throw error;
  }
  if (!carga) {
    return <Marco actual="/consola/proveedores" vista={vistaDeMarco(ctx)}><main id="contenido" className="pagina"><Cerrada tipo="libro" /></main></Marco>;
  }
  return (
    <Marco actual="/consola/proveedores" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina pagina-proveedores">
        <MesaProveedores
          lectura={carga.lectura} historial={carga.historial} empresaId={ctx.empresa.id} personaId={ctx.persona.id}
          hoy={fechaEnMexico()} vista={vista} q={params.q ?? ""} estado={params.estado ?? ""}
          pagoId={params.pago} proveedorId={params.proveedor}
          puedeSolicitar={puede(ctx, "cliente.pago.solicitar")} puedeLiberar={puede(ctx, "cliente.pago.liberar")}
          puedeAdministrar={puede(ctx, "cliente.proveedores.alta")}
        />
      </main>
    </Marco>
  );
}

async function cargar(ctx: ContextoConEmpresa, params: Params, vista: VistaProveedores) {
  const [lectura, historial] = await Promise.all([
    leerPagosProveedores(ctx, {
      q: params.q,
      estado: vista === "pagos" ? params.estado : undefined,
      pagina: Number(params.pagina) || 1,
      pagoId: params.pago,
    }),
    leerClabesProveedor(ctx),
  ]);
  return { lectura, historial };
}

function Cerrada({ tipo }: { tipo: string }) {
  const sinSesion = tipo === "sin_empresa";
  return <CabezaPagina kicker="Pagos a proveedores" titulo={sinSesion ? "Entra a tu empresa." : tipo === "sin_permiso" ? "Esta sección no abre con tu rol." : "No se pudo abrir la mesa de pagos."}>
    <p className="lede">{sinSesion ? "Selecciona una empresa para consultar proveedores y pagos." : "No se mostraron importes, documentos ni datos de proveedores."}</p>
    {sinSesion ? <Link className="boton" href="/entrar">Entrar</Link> : null}
  </CabezaPagina>;
}
