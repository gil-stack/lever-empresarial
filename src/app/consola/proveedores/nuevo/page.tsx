import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { FormularioPago } from "@/components/proveedores/formulario-pago";
import { CabezaPagina } from "@/components/sistema";
import { fechaEnMexico } from "@/dominio/pagos-proveedores";
import { enEmpresa } from "@/nucleo/rutas";
import type { ContextoConEmpresa } from "@/nucleo/contexto";
import { abrirRuta } from "@/server/entrada";
import { leerPagosProveedores } from "@/server/pagos-proveedores";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Nuevo pago a proveedor" };

export default async function NuevoPago({ searchParams }: { searchParams: Promise<{ proveedor?: string; pago?: string }> }) {
  const apertura = await abrirRuta("/consola/proveedores/nuevo");
  if (apertura.tipo !== "abierta" || !apertura.ctx.empresa) notFound();
  const ctx = apertura.ctx as ContextoConEmpresa;
  const params = await searchParams;
  const lectura = await leerPagosProveedores(ctx, { pagoId: params.pago });
  const edicion = params.pago ? lectura.pagos.find((pago) => pago.id === params.pago && pago.estado === "rechazado") : undefined;
  if (params.pago && !edicion) notFound();
  return <Marco actual="/consola/proveedores" vista={vistaDeMarco(ctx)}><main id="contenido" className="pagina pagina-nuevo-pago">
    <Link className="regresar" href={enEmpresa(ctx.empresa.id, edicion ? `/consola/proveedores?pago=${edicion.id}` : "/consola/proveedores")}>← Volver a pagos</Link>
    <CabezaPagina kicker={edicion ? "Corrección" : "Nueva instrucción"} titulo={edicion ? "Corrige y vuelve a solicitar." : "Prepara un pago."}>
      <p className="lede">La factura dicta los datos. Tú decides cuándo pagar y otra persona autoriza.</p>
    </CabezaPagina>
    <FormularioPago empresaId={ctx.empresa.id} proveedores={lectura.proveedores} proveedorInicial={params.proveedor} hoy={fechaEnMexico()} edicion={edicion} />
  </main></Marco>;
}
