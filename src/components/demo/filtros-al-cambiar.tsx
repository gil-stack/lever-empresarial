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
export function FiltrosAlCambiar({
  action,
  periodo,
  valores,
  enviados,
  children,
}: {
  action: string;
  periodo: string;
  /** Lo que dice la dirección para cada campo con nombre, ya leído por el servidor. */
  valores: Record<string, string>;
  /** Lo que la dirección lleva tal cual para esos campos: lo que se envió, antes de leerlo. */
  enviados: Record<string, string>;
  children: ReactNode;
}) {
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
      // Solo el botón principal hace clic: con el derecho o el central no llega ningún envío que esperar.
      botonTocado = evento.button === 0 && evento.target instanceof Element ? evento.target.closest('button[type="submit"]') : null;
    };
    // El clic del botón solo llega si se suelta encima de él; con el dedo, el «change» del monto llega después de
    // soltar, así que la marca no se apaga ahí. Si se suelta en otra parte, o el navegador cancela el gesto para
    // desplazar la página, se apaga: el siguiente cambio sale sin esperar.
    const alSoltar = (evento: PointerEvent) => {
      const encima = evento.type === "pointerup" ? document.elementFromPoint(evento.clientX, evento.clientY)?.closest('button[type="submit"]') : null;
      if (encima !== botonTocado) botonTocado = null;
    };
    // El menú contextual tampoco hace clic: en macOS, Ctrl + clic llega con el botón principal y abre el menú.
    const alAbrirMenu = () => {
      botonTocado = null;
    };
    // Un enlace que lleva a otra página gana: con el dedo, su clic llega antes que el envío aplazado del monto, y ese
    // envío navegaría después, de vuelta a los filtros. Un enlace que abre otra pestaña, o que lleva a esta misma
    // página, con o sin ancla (la dirección no cambia y los campos no se pondrían como ella), deja salir el envío.
    const alHacerClic = (evento: MouseEvent) => {
      const enlace = evento.target instanceof Element ? evento.target.closest("a[href]") : null;
      if (!(enlace instanceof HTMLAnchorElement) || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      if (enlace.target === "_blank" || enlace.href.split("#")[0] === location.href.split("#")[0]) return;
      clearTimeout(pendiente);
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
    nodo.addEventListener("contextmenu", alAbrirMenu, true);
    // En el documento: soltar fuera del formulario no pasa por él, ni los enlaces de fuera.
    document.addEventListener("pointerup", alSoltar, true);
    document.addEventListener("pointercancel", alSoltar, true);
    document.addEventListener("click", alHacerClic, true);
    nodo.addEventListener("change", alCambiar);
    nodo.addEventListener("submit", alEnviar);
    return () => {
      clearTimeout(pendiente);
      nodo.removeEventListener("pointerdown", alTocar, true);
      nodo.removeEventListener("contextmenu", alAbrirMenu, true);
      document.removeEventListener("pointerup", alSoltar, true);
      document.removeEventListener("pointercancel", alSoltar, true);
      document.removeEventListener("click", alHacerClic, true);
      nodo.removeEventListener("change", alCambiar);
      nodo.removeEventListener("submit", alEnviar);
    };
  }, []);
  // Los campos siguen a la dirección: al limpiar, con «Atrás» o «Adelante». El formulario no se vuelve a montar al
  // navegar, y React no aplica un `defaultValue` nuevo a un selector ya montado ni a un campo que ya se editó. También
  // cuando solo cambia lo enviado: un monto que el servidor ignora («-5») no cambia lo aplicado, y el campo lo dice.
  const deLaDireccion = JSON.stringify([valores, enviados]);
  const aplicados = useRef(valores);
  useEffect(() => {
    const nodo = forma.current;
    if (!nodo) return;
    const [nuevos, enLaDireccion] = JSON.parse(deLaDireccion) as Record<string, string>[];
    for (const [nombre, valor] of Object.entries(nuevos)) {
      const campo = nodo.elements.namedItem(nombre);
      if (!(campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement)) continue;
      // Lo que se está escribiendo y aún no sale se queda: la navegación que llega salió antes de escribirlo. Lo que ya
      // salió (lo lleva la dirección) no. Un monto a medias que aún no es número («1e», «-») vale «», como el aplicado,
      // pero el campo lo marca como entrada inválida.
      const escribiendo =
        campo === document.activeElement &&
        ((campo instanceof HTMLInputElement && campo.validity.badInput) ||
          (campo.value !== aplicados.current[nombre] && campo.value !== enLaDireccion[nombre]));
      if (!escribiendo) campo.value = valor;
    }
    aplicados.current = nuevos;
  }, [deLaDireccion]);
  return (
    // Sin validación del navegador: un monto con decimales de más o negativo bloquearía este envío y los siguientes. El
    // servidor ignora un monto que no es número o no es positivo, y redondea a centavos.
    <Form ref={forma} className="demo-filtros" action={action} scroll={false} noValidate>
      {/* El primer botón de envío es el que usa Enter: conserva el periodo actual en lugar de tomar «Hoy». */}
      <button type="submit" name="periodo" value={periodo} className="solo-lector" tabIndex={-1} aria-hidden="true">
        Filtrar
      </button>
      <input ref={campoPeriodo} type="hidden" name="periodo" value={periodo} disabled={!conJavaScript} />
      {children}
    </Form>
  );
}
