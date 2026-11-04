"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { IconoCerrar, IconoMenu } from "./iconos";

/** En pantallas angostas la navegación lateral se abre desde la izquierda; no se vuelve un menú de arriba. */
export function LateralMovil({ marca, children }: { marca: ReactNode; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    function alTeclear(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAbierto(false);
    }
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  function alPulsarDentro(evento: MouseEvent<HTMLElement>) {
    if ((evento.target as HTMLElement).closest("a")) setAbierto(false);
  }

  return (
    <>
      <div className="barra-movil">
        {marca}
        <button
          type="button"
          className="boton-menu"
          aria-expanded={abierto}
          aria-controls="lateral"
          onClick={() => setAbierto((valor) => !valor)}
        >
          {abierto ? <IconoCerrar /> : <IconoMenu />}
          <span>{abierto ? "Cerrar" : "Secciones"}</span>
        </button>
      </div>
      <aside id="lateral" className="lateral" data-abierto={abierto ? "si" : "no"} onClick={alPulsarDentro}>
        {children}
      </aside>
      {abierto ? <div className="velo" aria-hidden="true" onClick={() => setAbierto(false)} /> : null}
    </>
  );
}
