"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { VentanaDetalle } from "@/components/sistema";

/**
 * La ventana del detalle de una tarjeta sobre la lista (`?tarjeta=`). Cerrar (botón, Escape o clic afuera) quita la
 * tarjeta de la dirección sin mover la lista ni perder la búsqueda.
 */
export function VentanaDeTarjeta({ titulo, contexto, cerrarEn, children }: { titulo: string; contexto?: ReactNode; cerrarEn: string; children: ReactNode }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(true);
  const cerrar = () => {
    setAbierta(false);
    router.replace(cerrarEn, { scroll: false });
  };
  return (
    <VentanaDetalle abierto={abierta} alCerrar={cerrar} titulo={titulo} contexto={contexto}>
      {children}
    </VentanaDetalle>
  );
}
