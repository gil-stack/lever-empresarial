"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** La barra de arriba del lienzo: sobre la escena es transparente; al desplazar, se desenfoca como el diseño. */
export function BarraSuperior({ children }: { children: ReactNode }) {
  const barra = useRef<HTMLElement>(null);

  useEffect(() => {
    function alDesplazar() {
      barra.current?.toggleAttribute("data-desplazada", window.scrollY > 8);
    }
    alDesplazar();
    window.addEventListener("scroll", alDesplazar, { passive: true });
    return () => window.removeEventListener("scroll", alDesplazar);
  }, []);

  // N19: lo que tapan las barras pegadas arriba (en el teléfono, la móvil y esta) es el scroll-padding-top del documento
  // (marco.css). Así un ancla, «Saltar al contenido» o el campo que recibe el foco quedan debajo de las barras. Se mide
  // porque el alto cambia: el buscador o «Salir» bajan a otro renglón según la página y el ancho.
  useEffect(() => {
    const nodo = barra.current;
    if (!nodo) return;
    const raiz = document.documentElement;
    const medir = () => raiz.style.setProperty("--alto-barras", `${Math.ceil((parseFloat(getComputedStyle(nodo).top) || 0) + nodo.offsetHeight)}px`);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(nodo);
    // Al cruzar 960 px cambia el `top` (la barra móvil aparece encima) aunque el alto no cambie.
    window.addEventListener("resize", medir);
    return () => {
      observador.disconnect();
      window.removeEventListener("resize", medir);
      raiz.style.removeProperty("--alto-barras");
    };
  }, []);

  return (
    <header ref={barra} className="barra-superior">
      {children}
    </header>
  );
}
