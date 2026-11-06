"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { IconoCerrar, IconoMenu } from "./iconos";

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * En pantallas angostas la navegación lateral se abre desde la izquierda; no se vuelve un menú de arriba.
 * Abierto, el foco queda entre el botón «Cerrar» y el cajón: Tab da la vuelta y Escape cierra y regresa al botón.
 */
export function LateralMovil({ marca, children }: { marca: ReactNode; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const cajon = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!abierto) return;
    // Sin lo que está oculto (por ejemplo, el menú de empresas cerrado).
    const delCajon = () =>
      [...(cajon.current?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? [])].filter((elemento) =>
        elemento.checkVisibility({ visibilityProperty: true }),
      );
    delCajon()[0]?.focus();

    function alTeclear(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
        return;
      }
      if (evento.key !== "Tab") return;
      const lista = [boton.current, ...delCajon()].filter((elemento): elemento is HTMLElement => Boolean(elemento));
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      if (!primero || !ultimo) return;
      const dentro = lista.includes(document.activeElement as HTMLElement);
      if (evento.shiftKey && (document.activeElement === primero || !dentro)) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && (document.activeElement === ultimo || !dentro)) {
        evento.preventDefault();
        primero.focus();
      }
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
          ref={boton}
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
      <aside
        ref={cajon}
        id="lateral"
        className="lateral"
        data-abierto={abierto ? "si" : "no"}
        aria-label="Navegación"
        onClick={alPulsarDentro}
      >
        {children}
      </aside>
      {abierto ? <div className="velo" aria-hidden="true" onClick={() => setAbierto(false)} /> : null}
    </>
  );
}
