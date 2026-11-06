import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { RenglonesTarifa } from "@/components/precios/renglones";
import { SuscripcionEmpresa } from "@/components/precios/suscripcion-empresa";
import { Aviso } from "@/components/sistema";
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
    <Marco actual="/consola/configuracion" vista={vistaDeMarco(ctx)} titulo="Plan">
      <main id="contenido" className="precios plan-empresa">
        <h1 className="solo-lector">Plan de la empresa</h1>
        {apertura.tipo === "libro" ? <Aviso titulo="No se pudo confirmar la empresa">La tarifa publicada se muestra sin los datos de tu suscripción.</Aviso> : null}
        <SuscripcionEmpresa tarifa={tarifa} lectura={suscripcion} />
        <RenglonesTarifa tarifa={tarifa} />
      </main>
    </Marco>
  );
}
