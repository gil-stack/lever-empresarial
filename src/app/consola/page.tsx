import type { Metadata } from "next";
import { ConsolaVacia } from "@/components/consola/consola-vacia";
import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { leerEntrada, sesionSegura } from "@/server/entrada";
import { esOperadorActual, leerSuscripcionDeLaSesion, leerTarifa } from "@/server/precio";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Consola",
};

export default async function PaginaConsola({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string | string[] }>;
}) {
  const params = await searchParams;
  const pedido = typeof params.companyId === "string" ? params.companyId : null;
  const sesionPendiente = sesionSegura();
  const [entrada, sesion, tarifa, suscripcion] = await Promise.all([
    leerEntrada(pedido),
    sesionPendiente,
    leerTarifa(),
    sesionPendiente.then((sesionLeida) => leerSuscripcionDeLaSesion(sesionLeida)),
  ]);
  const empresa =
    entrada.rfc && entrada.razonSocial ? { rfc: entrada.rfc, razonSocial: entrada.razonSocial } : null;

  return (
    <>
      <Encabezado actual="/consola" persona={entrada.nombre ? { nombre: entrada.nombre } : null} />
      <main id="contenido">
        <ConsolaVacia
          empresa={empresa}
          libroDisponible={entrada.libroDisponible}
          conSesion={entrada.nombre !== null}
          tarifa={tarifa}
          suscripcion={suscripcion}
          esOperador={esOperadorActual(sesion)}
        />
      </main>
      <Pie />
    </>
  );
}
