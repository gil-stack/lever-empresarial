import type { Metadata } from "next";
import { ConsolaVacia } from "@/components/consola/consola-vacia";
import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { leerEntrada } from "@/server/entrada";

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
  const entrada = await leerEntrada(pedido);
  const empresa =
    entrada.rfc && entrada.razonSocial ? { rfc: entrada.rfc, razonSocial: entrada.razonSocial } : null;

  return (
    <>
      <Encabezado actual="/consola" />
      <main id="contenido">
        <ConsolaVacia empresa={empresa} libroDisponible={entrada.libroDisponible} />
      </main>
      <Pie />
    </>
  );
}
