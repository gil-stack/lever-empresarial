import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { FormularioPublicar } from "@/components/precios/formulario-publicar";
import { RenglonesTarifa } from "@/components/precios/renglones";
import { CabezaPagina } from "@/components/sistema";
import { existePasoPublicar } from "@/dominio/precio";
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
  const tarifa = await leerTarifa();
  const publicar = existePasoPublicar({
    esOperador: Boolean(ctx && puede(ctx, "plataforma.precio.publicar")),
    montoPublicado: tarifa.suscripcionPublicada,
    disponible: tarifa.disponible,
  });

  return (
    <Marco actual="/precios" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="precios">
        <CabezaPagina kicker="Precios" titulo="Suscripción y costo del participante">
          <p className="lede">La consola muestra los mismos renglones. El monto lo publica la plataforma.</p>
        </CabezaPagina>
        <RenglonesTarifa tarifa={tarifa} />
        {publicar ? <FormularioPublicar /> : null}
      </main>
    </Marco>
  );
}
