import type { Metadata } from "next";
import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { TelefonoSinFlujo } from "@/components/telefono/telefono-sin-flujo";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Teléfono",
};

export default function PaginaTelefono() {
  return (
    <>
      <Encabezado actual="/telefono" superficie="telefono" />
      <main id="contenido" className="superficie-telefono">
        <TelefonoSinFlujo />
      </main>
      <Pie />
    </>
  );
}
