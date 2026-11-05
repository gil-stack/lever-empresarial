import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { FormularioProveedor } from "@/components/proveedores/formulario";
import { CabezaPagina, NotaRegla } from "@/components/sistema";
import { enEmpresa } from "@/nucleo/rutas";
import type { ContextoConEmpresa } from "@/nucleo/contexto";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alta de proveedor" };

export default async function NuevoProveedor() {
  const apertura = await abrirRuta("/consola/proveedores/nuevo-proveedor");
  if (apertura.tipo !== "abierta" || !apertura.ctx.empresa) notFound();
  const ctx = apertura.ctx as ContextoConEmpresa;
  return <Marco actual="/consola/proveedores" vista={vistaDeMarco(ctx)}><main id="contenido" className="pagina pagina-nuevo-proveedor">
    <Link className="regresar" href={enEmpresa(ctx.empresa.id, "/consola/proveedores?vista=proveedores")}>← Volver al directorio</Link>
    <CabezaPagina kicker="Expediente nuevo" titulo="Alta de proveedor"><p className="lede">Identidad, depósito y documentos en un solo expediente. Después podrás agregar más contratos.</p></CabezaPagina>
    <div className="alta-proveedor-layout"><div className="alta-proveedor-forma"><FormularioProveedor /></div><aside className="alta-proveedor-guia"><p className="kicker">Antes del primer pago</p><h2>La evidencia manda.</h2><p>La constancia identifica al proveedor. La CLABE se valida antes de guardar y cada cambio posterior deja historial.</p><NotaRegla>El alta no mueve dinero. La lista 69-B puede permitir el expediente y mantener el pago bloqueado.</NotaRegla></aside></div>
  </main></Marco>;
}
