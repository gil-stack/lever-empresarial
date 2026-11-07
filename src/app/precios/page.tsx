import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { RenglonesTarifa } from "@/components/precios/renglones";
import { CabezaPagina } from "@/components/sistema";
import { puede } from "@/nucleo/contexto";
import { abrirRuta } from "@/server/entrada";
import { leerTarifa } from "@/server/precio";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Precios",
  description:
    "Suscripción mensual por empresa y costo SPEI del participante. Por persona, por tarjeta y de implementación, en cero.",
};

export default async function PaginaPrecios() {
  const apertura = await abrirRuta("/precios");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  // El personal SOFIPO ve y publica el monto dentro de Operación, con su marco y su navegación.
  if (puede(ctx, "plataforma.precio.publicar")) redirect("/operacion/precios");
  const tarifa = await leerTarifa();

  return (
    <Marco actual="/precios" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="precios">
        <CabezaPagina kicker="Precios" titulo="Suscripción y costo del participante">
          <p className="lede">La consola muestra los mismos renglones. El monto lo publica la plataforma.</p>
        </CabezaPagina>
        <RenglonesTarifa tarifa={tarifa} />
      </main>
    </Marco>
  );
}
