import type { Metadata } from "next";

import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { FormularioPublicar } from "@/components/precios/formulario-publicar";
import { RenglonesTarifa } from "@/components/precios/renglones";
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
    <>
      <Encabezado actual="/precios" persona={sesion ? { nombre: sesion.usuario.nombre } : null} />
      <main id="contenido" className="precios">
        <p className="kicker">Precios</p>
        <h1 id="titulo-precios">
          Dos
          <br />
          renglones.
        </h1>
        <p className="lede">
          La suscripción de la plataforma y el costo SPEI del participante. La consola lee este mismo campo.
        </p>
        <RenglonesTarifa tarifa={tarifa} />
        {publicar ? <FormularioPublicar /> : null}
      </main>
      <Pie />
    </>
  );
}
