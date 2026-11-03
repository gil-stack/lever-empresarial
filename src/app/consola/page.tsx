import type { Metadata } from "next";
import { ConsolaVacia } from "@/components/consola/consola-vacia";
import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { leerSesion } from "@/server/sesion/leer-sesion";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Consola",
};

export default async function PaginaConsola() {
  const sesion = await leerSesion();

  return (
    <>
      <Encabezado actual="/consola" />
      <main id="contenido">
        <ConsolaVacia sesion={sesion} />
      </main>
      <Pie />
    </>
  );
}
