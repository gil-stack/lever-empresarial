"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { IconoCerrar, IconoMenu } from "./iconos";
import { AvisarCarga } from "./progreso-enlace";
import { esVisible } from "./visible";

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
/** El mismo corte que en marco.css: arriba de él no hay cajón. */
const PANTALLA_ANGOSTA = "(max-width: 960px)";

/**
 * En pantallas angostas la navegación lateral se abre desde la izquierda; no se vuelve un menú de arriba.
 * Abierto, el foco queda entre el botón «Cerrar» y el cajón: Tab da la vuelta, y Escape o tocar el velo
 * cierran y regresan el foco al botón. El resto del marco queda `inert` mientras tanto.
 *
 * Al pulsar una sección el cajón se cierra y el progreso de su enlace queda dentro, oculto: mientras
 * la sección carga, la barra de arriba lo dice, y la página anterior sigue a la vista.
 */
export function LateralMovil({ marca, children }: { marca: ReactNode; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const cajon = useRef<HTMLElement>(null);
  const [cargando, setCargando] = useState(0);
  const avisarCarga = useCallback((si: boolean) => setCargando((n) => Math.max(0, n + (si ? 1 : -1))), []);

  function cerrar() {
    setAbierto(false);
    boton.current?.focus();
  }

  useEffect(() => {
    if (!abierto) return;
    // Sin lo que está oculto (por ejemplo, el menú de empresas cerrado).
    const delCajon = () => [...(cajon.current?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? [])].filter(esVisible);
    delCajon()[0]?.focus();

    // La página y la barra de arriba no reciben foco ni clics: solo el cajón y su botón.
    const fondo = [...(cajon.current?.parentElement?.children ?? [])].filter(
      (elemento) => elemento !== cajon.current && !elemento.contains(boton.current) && !elemento.classList.contains("velo"),
    );
    for (const elemento of fondo) elemento.setAttribute("inert", "");

    // Si la ventana se ensancha, el lateral vuelve a ser fijo y el cajón no existe: se cierra.
    const angosta = window.matchMedia(PANTALLA_ANGOSTA);
    const alCambiarAncho = () => {
      if (!angosta.matches) setAbierto(false);
    };
    angosta.addEventListener("change", alCambiarAncho);

    function alTeclear(evento: KeyboardEvent) {
      // Un menú abierto dentro del cajón ya atendió la tecla (Escape o Tab).
      if (evento.defaultPrevented) return;
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
    return () => {
      document.removeEventListener("keydown", alTeclear);
      angosta.removeEventListener("change", alCambiarAncho);
      for (const elemento of fondo) elemento.removeAttribute("inert");
    };
  }, [abierto]);

  function alPulsarDentro(evento: MouseEvent<HTMLElement>) {
    if ((evento.target as HTMLElement).closest("a")) setAbierto(false);
  }

  return (
    <>
      <div className="barra-movil">
        {marca}
        <span className="barra-movil-carga" role="status">
          {cargando > 0 ? (
            <>
              <span className="seccion-spinner" aria-hidden="true" />
              Cargando…
            </>
          ) : null}
        </span>
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
        <AvisarCarga.Provider value={avisarCarga}>{children}</AvisarCarga.Provider>
      </aside>
      {abierto ? <div className="velo" aria-hidden="true" onClick={cerrar} /> : null}
    </>
  );
}
