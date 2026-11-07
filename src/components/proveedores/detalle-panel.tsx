"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { PanelDetalle } from "@/components/sistema";

/**
 * El detalle de un pago o el expediente de un proveedor, en el panel lateral
 * del sistema. Lo abre la dirección (`?pago=` o `?proveedor=`); cerrarlo con
 * el botón, Escape o el velo regresa a la mesa sin esa parte de la dirección.
 */
export function DetalleEnPanel({
  titulo,
  contexto,
  cerrar,
  children,
}: {
  titulo: string;
  contexto: string;
  cerrar: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(true);
  return (
    <PanelDetalle
      abierto={abierto}
      titulo={titulo}
      contexto={contexto}
      alCerrar={() => {
        setAbierto(false);
        router.push(cerrar, { scroll: false });
      }}
    >
      {children}
    </PanelDetalle>
  );
}
