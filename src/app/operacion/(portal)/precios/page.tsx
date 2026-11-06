import type { Metadata } from "next";

import { PaginaOperacion } from "@/components/operacion/pagina";
import { FormularioPublicar } from "@/components/precios/formulario-publicar";
import { RenglonesTarifa } from "@/components/precios/renglones";
import { existePasoPublicar } from "@/dominio/precio";
import { puede } from "@/nucleo/contexto";
import { leerTarifa } from "@/server/precio";
import { exigirContextoOperacion } from "@/server/operacion/contexto";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Precios · Operación" };

/** Lo mismo que ve el cliente en /precios; aquí, además, el personal publica el monto una sola vez. */
export default async function PreciosOperacion() {
  const ctx = await exigirContextoOperacion();
  const tarifa = await leerTarifa();
  const publicar = existePasoPublicar({
    esOperador: puede(ctx, "plataforma.precio.publicar"),
    montoPublicado: tarifa.suscripcionPublicada,
    disponible: tarifa.disponible,
  });
  return (
    <PaginaOperacion
      titulo="Precios"
      entrada="Lo que ve cada cliente en Precios y en su plan. La suscripción se publica una sola vez y no se puede cambiar."
    >
      <div className="operacion-precios">
        <RenglonesTarifa tarifa={tarifa} />
        {publicar ? <FormularioPublicar /> : null}
      </div>
    </PaginaOperacion>
  );
}
