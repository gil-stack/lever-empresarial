import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { puertasDe } from "@/components/cromo/puertas";
import { FormularioPublicar } from "@/components/precios/formulario-publicar";
import { RenglonesTarifa } from "@/components/precios/renglones";
import { CabezaPagina } from "@/components/sistema";
import { existePasoPublicar } from "@/dominio/precio";
import { sesionSegura } from "@/server/entrada";
import { esOperadorActual, leerTarifa } from "@/server/precio";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Precios",
  description:
    "Suscripción mensual por empresa y costo SPEI del participante. Por persona, por tarjeta y de implementación, en cero.",
};

export default async function PaginaPrecios() {
  const [sesion, tarifa] = await Promise.all([sesionSegura(), leerTarifa()]);
  const publicar = existePasoPublicar({
    esOperador: esOperadorActual(sesion),
    montoPublicado: tarifa.suscripcionPublicada,
    disponible: tarifa.disponible,
  });

  return (
    <Marco
      actual="/precios"
      persona={sesion ? { nombre: sesion.usuario.nombre } : null}
      {...puertasDe(sesion?.rol, Boolean(sesion?.companyId))}
    >
      <main id="contenido" className="precios">
        <CabezaPagina kicker="Precios" titulo="Suscripción y costo del participante">
          <p className="lede">La consola muestra los mismos renglones.</p>
        </CabezaPagina>
        <RenglonesTarifa tarifa={tarifa} />
        {publicar ? <FormularioPublicar /> : null}
      </main>
    </Marco>
  );
}
