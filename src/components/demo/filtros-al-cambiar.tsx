"use client";

import Form from "next/form";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * El formulario GET de los filtros de Movimientos. Con JavaScript filtra en cuanto cambia un
 * campo, como `mfBar` del diseño, que no tiene botón «Filtrar»; sin JavaScript lo envía el
 * botón que la vista pone en `<noscript>`.
 */
export function FiltrosAlCambiar({ action, children }: { action: string; children: ReactNode }) {
  const forma = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const nodo = forma.current;
    if (!nodo) return;
    // El «change» nativo llega al elegir en un selector y al salir del monto (o con Enter), no en cada tecla.
    const enviar = () => nodo.requestSubmit();
    nodo.addEventListener("change", enviar);
    return () => nodo.removeEventListener("change", enviar);
  }, []);
  return (
    <Form ref={forma} className="demo-filtros" action={action} scroll={false}>
      {children}
    </Form>
  );
}
