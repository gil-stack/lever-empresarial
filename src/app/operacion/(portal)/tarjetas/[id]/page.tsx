import { notFound, redirect } from "next/navigation";

import { enlaceTarjetas } from "@/dominio/tarjetas/inventario";
import { idDeTarjeta } from "@/server/efevoo/detalle-tarjeta";
import { exigirContextoOperacion } from "@/server/operacion";

export const runtime = "nodejs";

/** La dirección vieja del detalle: ahora el detalle se abre en una ventana sobre la lista. */
export default async function TarjetaOperacion({ params }: { params: Promise<{ id: string }> }) {
  await exigirContextoOperacion();
  const id = idDeTarjeta((await params).id);
  if (id === null) notFound();
  redirect(enlaceTarjetas({ tarjeta: id }));
}
