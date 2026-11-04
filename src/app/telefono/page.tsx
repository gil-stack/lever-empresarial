import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MarcoTelefono } from "@/components/cromo/marco";
import { TelefonoSinFlujo } from "@/components/telefono/telefono-sin-flujo";
import { leerEntrada } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Teléfono",
};

export default async function PaginaTelefono() {
  const entrada = await leerEntrada();
  if (!entrada.nombre) redirect("/entrar?siguiente=/telefono");

  return (
    <MarcoTelefono>
      <TelefonoSinFlujo />
    </MarcoTelefono>
  );
}
