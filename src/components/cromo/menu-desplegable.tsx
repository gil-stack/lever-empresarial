"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { IconoChevron } from "./iconos";

/**
 * Un botón que abre un menú (la empresa y la persona, como el diseño). Al abrir,
 * el foco va a la primera opción; las flechas recorren, Escape cierra y regresa
 * el foco al botón; un clic fuera o elegir una opción también cierra.
 */
export function MenuDesplegable({
  clase,
  etiqueta,
  disparador,
  children,
}: {
  clase: string;
  /** Nombre del menú para el lector de pantalla. */
  etiqueta: string;
  disparador: ReactNode;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const opciones = () => [...(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    opciones()[0]?.focus();

    function alTeclear(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
      } else if (evento.key === "Tab") {
        setAbierto(false);
      } else if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
        evento.preventDefault();
        const lista = opciones();
        const actual = lista.indexOf(document.activeElement as HTMLElement);
        const paso = evento.key === "ArrowDown" ? 1 : -1;
        lista[(actual + paso + lista.length) % lista.length]?.focus();
      }
    }
    function alPulsar(evento: PointerEvent) {
      if (!raiz.current?.contains(evento.target as Node)) setAbierto(false);
    }
    document.addEventListener("keydown", alTeclear);
    document.addEventListener("pointerdown", alPulsar);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.removeEventListener("pointerdown", alPulsar);
    };
  }, [abierto]);

  function alElegir(evento: MouseEvent<HTMLElement>) {
    if ((evento.target as HTMLElement).closest('[role="menuitem"]')) setAbierto(false);
  }

  return (
    <div ref={raiz} className={`menu-desplegable ${clase}`}>
      <button
        ref={boton}
        type="button"
        className="menu-desplegable-boton"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((valor) => !valor)}
      >
        {disparador}
        <span className="menu-chevron" aria-hidden="true">
          <IconoChevron />
        </span>
      </button>
      <div id={id} role="menu" aria-label={etiqueta} className="menu-flotante" data-abierto={abierto ? "si" : "no"} onClick={alElegir}>
        {children}
      </div>
    </div>
  );
}
