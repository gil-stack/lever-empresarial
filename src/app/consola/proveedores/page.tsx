import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { MesaProveedores, type VistaProveedores } from "@/components/proveedores/mesa";
import { CabezaPagina } from "@/components/sistema";
import { fechaEnMexico } from "@/dominio/pagos-proveedores";
import { puede, type ContextoConEmpresa } from "@/nucleo/contexto";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { enEmpresa } from "@/nucleo/rutas";
import { leerPagosProveedores } from "@/server/pagos-proveedores";
import { leerClabesProveedor } from "@/server/proveedores";
import type { LecturaClabes } from "@/server/proveedores/tipos";
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
  const accion = puede(ctx, "cliente.pago.solicitar")
    ? <Link className="boton" href={enEmpresa(ctx.empresa.id, "/consola/proveedores/nuevo")}>Nuevo pago</Link>
    : null;
  return (
    <Marco actual="/consola/proveedores" vista={vistaDeMarco(ctx)} accion={accion}>
      <main id="contenido" className="pagina pagina-proveedores">
        <MesaProveedores
          lectura={carga.lectura} historial={carga.historial} empresaId={ctx.empresa.id} personaId={ctx.persona.id}
          hoy={fechaEnMexico()} vista={vista} q={params.q ?? ""} estado={params.estado ?? ""}
          pagoId={params.pago} proveedorId={params.proveedor}
          puedeSolicitar={puede(ctx, "cliente.pago.solicitar")} puedeLiberar={puede(ctx, "cliente.pago.liberar")}
          puedeCancelarListo={puede(ctx, "cliente.pago.cancelar_listo")}
          puedeAdministrar={puede(ctx, "cliente.proveedores.alta")}
        />
      </main>
    </Marco>
  );
}

const SIN_HISTORIAL: LecturaClabes = { puedeCambiar: false, grupos: [] };

async function cargar(ctx: ContextoConEmpresa, params: Params, vista: VistaProveedores) {
  const [lectura, historial] = await Promise.all([
    leerPagosProveedores(ctx, {
      q: params.q,
      estado: vista === "pagos" ? params.estado : undefined,
      pagina: Number(params.pagina) || 1,
      pagoId: params.pago,
    }),
    // El historial de CLABEs completas es del expediente: quien solo solicita no lo recibe.
    puede(ctx, "cliente.proveedores.expediente.ver") ? leerClabesProveedor(ctx) : Promise.resolve(SIN_HISTORIAL),
  ]);
  return { lectura, historial };
}

function Cerrada({ tipo }: { tipo: string }) {
  const sinSesion = tipo === "sin_empresa";
  const sinPermiso = tipo === "sin_permiso";
  return <CabezaPagina kicker="Proveedores" titulo={sinSesion ? "Elige una empresa." : sinPermiso ? "Tu rol no abre Proveedores." : "No se pudo abrir la mesa de pagos."}>
    <p className="lede">{sinSesion ? "Proveedores y pagos se consultan dentro de una empresa." : sinPermiso ? "Pide a quien administra la empresa el rol que necesitas." : "Vuelve a intentarlo en un momento."}</p>
    {sinSesion ? <Link className="boton" href="/empresas">Elegir empresa</Link> : null}
  </CabezaPagina>;
}
