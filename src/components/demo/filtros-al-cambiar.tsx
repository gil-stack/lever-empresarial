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
    // Con Enter el navegador también envía el formulario justo después del «change»: el envío se aplaza
    // un turno y se cancela si el formulario ya salió, para que Enter navegue una sola vez.
    let pendiente: ReturnType<typeof setTimeout> | undefined;
    const alCambiar = () => {
      clearTimeout(pendiente);
      pendiente = setTimeout(() => nodo.requestSubmit());
    };
    const alEnviar = () => clearTimeout(pendiente);
    nodo.addEventListener("change", alCambiar);
    nodo.addEventListener("submit", alEnviar);
    return () => {
      clearTimeout(pendiente);
      nodo.removeEventListener("change", alCambiar);
      nodo.removeEventListener("submit", alEnviar);
    };
  }, []);
  return (
    <Form ref={forma} className="demo-filtros" action={action} scroll={false}>
      {children}
    </Form>
  );
}
