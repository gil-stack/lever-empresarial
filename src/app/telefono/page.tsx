import type { Metadata } from "next";
import { MarcoTelefono } from "@/components/cromo/marco";
import { TelefonoSinFlujo } from "@/components/telefono/telefono-sin-flujo";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Teléfono",
};

export default function PaginaTelefono() {
  return (
    <MarcoTelefono>
      <main id="contenido" className="superficie-telefono">
        <TelefonoSinFlujo />
      </main>
    </MarcoTelefono>
  );
}
