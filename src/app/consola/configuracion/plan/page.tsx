import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { RenglonesTarifa } from "@/components/precios/renglones";
import { SuscripcionEmpresa } from "@/components/precios/suscripcion-empresa";
import { CabezaPagina } from "@/components/sistema";
import { abrirRuta } from "@/server/entrada";
import { leerSuscripcionDeLaEmpresa, leerTarifa } from "@/server/precio";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Plan" };

export default async function PaginaPlan() {
  const apertura = await abrirRuta("/consola/configuracion/plan");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const tarifa = await leerTarifa();
  const suscripcion = apertura.tipo === "abierta" ? await leerSuscripcionDeLaEmpresa(apertura.ctx) : { tipo: "sin_empresa" as const };
  return (
    <Marco actual="/consola/configuracion" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="precios">
        <CabezaPagina kicker="Configuración" titulo="Plan">
          <p className="lede">Consulta la suscripción de esta empresa y los renglones publicados por la plataforma.</p>
        </CabezaPagina>
        {apertura.tipo === "libro" ? <div className="alerta" role="alert"><p>No se pudo confirmar la empresa. La tarifa pública se muestra sin datos de suscripción.</p></div> : null}
        <RenglonesTarifa tarifa={tarifa} />
        <SuscripcionEmpresa tarifa={tarifa} lectura={suscripcion} />
      </main>
    </Marco>
  );
}
