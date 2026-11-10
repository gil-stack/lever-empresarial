import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { ModuloDiseno } from "@/components/demo/modulo";
import { VistaDemo } from "@/components/demo/vista";
import { leerDemo } from "@/server/demo";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Ahorro" };

/** Módulo de demostración: datos de ejemplo solo en empresas de demostración; en una real, «Disponible pronto». */
export default async function PaginaAhorro() {
  const apertura = await abrirRuta("/consola/ahorro");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const carga = leerDemo(apertura.tipo === "abierta" ? ctx : null, "ahorro");
  return (
    <Marco actual="/consola/ahorro" vista={vistaDeMarco(ctx)}>
      <ModuloDiseno titulo="Ahorro">
        <VistaDemo carga={carga} empresaId={ctx?.empresa?.id ?? null} />
      </ModuloDiseno>
    </Marco>
  );
}
