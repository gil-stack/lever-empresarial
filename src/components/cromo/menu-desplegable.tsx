"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { IconoChevron } from "./iconos";

const OPCIONES = '[role="menuitem"], [role="menuitemradio"]';

/**
 * Un botón que abre un menú (la empresa y la persona, como el diseño). Al abrir,
 * el foco va a la primera opción; las flechas recorren (las opciones van con
 * tabIndex -1), y Escape o Tab cierran y regresan el foco al botón; un clic fuera
 * o elegir una opción también cierra. La tecla la atiende antes que nadie (fase de
 * captura) y no la deja pasar: el primer Escape cierra el menú, no el cajón que lo
 * contiene.
 *
 * `fijo`: el menú se coloca con posición fija bajo el botón, para que un
 * contenedor con scroll (el lateral de 240 px) no lo recorte. Se cierra si la
 * página o el lateral se desplazan o cambia el tamaño de la ventana. Con
 * `hacia="arriba"` abre sobre el botón (el menú de la persona al pie del lateral).
 *
 * Las opciones de radio (`menuitemradio`, como el tema) se recorren igual que las demás.
 */
export function MenuDesplegable({
  clase,
  etiqueta,
  disparador,
  fijo = false,
  hacia = "abajo",
  children,
}: {
  clase: string;
  /** Nombre del menú para el lector de pantalla. */
  etiqueta: string;
  disparador: ReactNode;
  fijo?: boolean;
  /** Solo con `fijo`. */
  hacia?: "abajo" | "arriba";
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<CSSProperties | undefined>(undefined);
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const opciones = () => [...(menu.current?.querySelectorAll<HTMLElement>(OPCIONES) ?? [])];
    opciones()[0]?.focus({ preventScroll: true });

    function cerrarAlBoton(evento: KeyboardEvent) {
      evento.preventDefault();
      evento.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    }
    function alTeclear(evento: KeyboardEvent) {
      if (evento.key === "Escape" || evento.key === "Tab") {
        cerrarAlBoton(evento);
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
    function alDesplazar(evento: Event) {
      if (!menu.current?.contains(evento.target as Node)) setAbierto(false);
    }
    const cerrar = () => setAbierto(false);
    document.addEventListener("keydown", alTeclear, true);
    document.addEventListener("pointerdown", alPulsar);
    if (fijo) {
      window.addEventListener("scroll", alDesplazar, true);
      window.addEventListener("resize", cerrar);
    }
    return () => {
      document.removeEventListener("keydown", alTeclear, true);
      document.removeEventListener("pointerdown", alPulsar);
      window.removeEventListener("scroll", alDesplazar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto, fijo]);

  function alternar() {
    if (!abierto && fijo && boton.current) {
      const caja = boton.current.getBoundingClientRect();
      if (hacia === "arriba") {
        const abajo = window.innerHeight - caja.top + 8;
        setPosicion({ position: "fixed", top: "auto", bottom: abajo, left: caja.left, width: Math.max(caja.width, 240), maxHeight: `calc(100dvh - ${Math.round(abajo + 16)}px)` });
      } else {
        const arriba = caja.bottom + 8;
        setPosicion({ position: "fixed", top: arriba, left: caja.left, maxHeight: `calc(100dvh - ${Math.round(arriba + 16)}px)` });
      }
    }
    setAbierto((valor) => !valor);
  }

  function alElegir(evento: MouseEvent<HTMLElement>) {
    if ((evento.target as HTMLElement).closest(OPCIONES)) setAbierto(false);
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
        onClick={alternar}
      >
        {disparador}
        <span className="menu-chevron" aria-hidden="true">
          <IconoChevron />
        </span>
      </button>
      <div
        ref={menu}
        id={id}
        role="menu"
        aria-label={etiqueta}
        className="menu-flotante"
        data-hacia={fijo ? hacia : undefined}
        data-abierto={abierto ? "si" : "no"}
        style={fijo ? posicion : undefined}
        onClick={alElegir}
      >
        {children}
      </div>
    </div>
  );
}
