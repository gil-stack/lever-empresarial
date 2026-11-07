"use client";

import Form from "next/form";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

const sinSuscripcion = () => () => {};

/**
 * El formulario GET de los filtros de Movimientos. Con JavaScript filtra en cuanto cambia un
 * campo, como `mfBar` del diseño, que no tiene botón «Filtrar»; sin JavaScript lo envía el
 * botón que la vista pone en `<noscript>`. Los periodos son botones de este formulario: un
 * toque lleva el periodo y el monto recién escrito en la misma navegación.
 */
export function FiltrosAlCambiar({ action, periodo, children }: { action: string; periodo: string; children: ReactNode }) {
  const forma = useRef<HTMLFormElement>(null);
  const campoPeriodo = useRef<HTMLInputElement>(null);
  // Sin JavaScript el navegador manda el botón que envía (un periodo o «Filtrar», que lleva el actual) y este campo
  // va apagado para no repetirlo. Con JavaScript next/form arma la dirección sin ese botón: el campo lleva el periodo.
  const conJavaScript = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  useEffect(() => {
    const nodo = forma.current;
    if (!nodo) return;
    // El «change» nativo llega al elegir en un selector y al salir del monto (o con Enter), no en cada tecla.
    // Con Enter el navegador también envía el formulario justo después del «change»: el envío se aplaza
    // un turno y se cancela si el formulario ya salió, para que Enter navegue una sola vez. Si el monto pierde
    // el foco porque se está tocando un periodo, se espera más: el envío de ese botón lo cancela y lleva los dos.
    let pendiente: ReturnType<typeof setTimeout> | undefined;
    let botonTocado: Element | null = null;
    const alTocar = (evento: PointerEvent) => {
      botonTocado = evento.target instanceof Element ? evento.target.closest('button[type="submit"]') : null;
    };
    // El clic del botón solo llega si se suelta encima de él; con el dedo, el «change» del monto llega después de
    // soltar, así que la marca no se apaga ahí. Si se suelta en otra parte, o el navegador cancela el gesto para
    // desplazar la página, se apaga: el siguiente cambio sale sin esperar.
    const alSoltar = (evento: PointerEvent) => {
      const encima = evento.type === "pointerup" ? document.elementFromPoint(evento.clientX, evento.clientY)?.closest('button[type="submit"]') : null;
      if (encima !== botonTocado) botonTocado = null;
    };
    const alCambiar = () => {
      clearTimeout(pendiente);
      pendiente = setTimeout(() => nodo.requestSubmit(), botonTocado ? 500 : 0);
    };
    const alEnviar = (evento: SubmitEvent) => {
      clearTimeout(pendiente);
      botonTocado = null;
      const boton = evento.submitter;
      if (boton instanceof HTMLButtonElement && boton.name === "periodo" && campoPeriodo.current) campoPeriodo.current.value = boton.value;
    };
    nodo.addEventListener("pointerdown", alTocar, true);
    // En el documento: soltar fuera del formulario no pasa por él.
    document.addEventListener("pointerup", alSoltar, true);
    document.addEventListener("pointercancel", alSoltar, true);
    nodo.addEventListener("change", alCambiar);
    nodo.addEventListener("submit", alEnviar);
    return () => {
      clearTimeout(pendiente);
      nodo.removeEventListener("pointerdown", alTocar, true);
      document.removeEventListener("pointerup", alSoltar, true);
      document.removeEventListener("pointercancel", alSoltar, true);
      nodo.removeEventListener("change", alCambiar);
      nodo.removeEventListener("submit", alEnviar);
    };
  }, []);
  return (
    <Form ref={forma} className="demo-filtros" action={action} scroll={false}>
      {/* El primer botón de envío es el que usa Enter: conserva el periodo actual en lugar de tomar «Hoy». */}
      <button type="submit" name="periodo" value={periodo} className="solo-lector" tabIndex={-1} aria-hidden="true">
        Filtrar
      </button>
      <input ref={campoPeriodo} type="hidden" name="periodo" value={periodo} disabled={!conJavaScript} />
      {children}
    </Form>
  );
}
