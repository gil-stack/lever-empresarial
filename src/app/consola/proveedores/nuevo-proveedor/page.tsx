import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { FormularioProveedor } from "@/components/proveedores/formulario";
import { NotaRegla } from "@/components/sistema";
import { enEmpresa } from "@/nucleo/rutas";
import type { ContextoConEmpresa } from "@/nucleo/contexto";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alta de proveedor" };

export default async function NuevoProveedor() {
  const apertura = await abrirRuta("/consola/proveedores/nuevo-proveedor");
  if (apertura.tipo !== "abierta" || !apertura.ctx.empresa) notFound();
  const ctx = apertura.ctx as ContextoConEmpresa;
  return <Marco actual="/consola/proveedores" titulo="Alta de proveedor" vista={vistaDeMarco(ctx)}><main id="contenido" className="pagina pagina-nuevo-proveedor">
    <h1 className="solo-lector">Alta de proveedor</h1>
    <Link className="regresar" href={enEmpresa(ctx.empresa.id, "/consola/proveedores?vista=proveedores")}>← Volver al directorio</Link>
    <div className="alta-proveedor-layout">
      <section className="panel alta-proveedor-forma" aria-labelledby="alta-proveedor-titulo">
        <div className="panel-cabeza"><h2 id="alta-proveedor-titulo">Expediente del proveedor</h2><small>Identidad, CLABE y documentos</small></div>
        <FormularioProveedor />
      </section>
      <aside className="alta-proveedor-guia" aria-labelledby="alta-guia-titulo">
        <p className="kicker">Antes del primer pago</p>
        <h2 id="alta-guia-titulo">La constancia identifica al proveedor.</h2>
        <p>La CLABE se valida antes de guardar y cada cambio posterior deja historial. Después puedes agregar más contratos desde su expediente.</p>
        <NotaRegla>Si el RFC aparece en la lista 69-B, el expediente se guarda y el pago queda bloqueado.</NotaRegla>
      </aside>
    </div>
  </main></Marco>;
}
