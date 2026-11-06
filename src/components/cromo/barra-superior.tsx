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

  return (
    <header ref={barra} className="barra-superior">
      {children}
    </header>
  );
}
