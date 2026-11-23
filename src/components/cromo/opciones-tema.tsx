"use client";

import { useApariencia, fijarTema } from "@/components/apariencia/viva";

import { IconoLuna, IconoSol } from "./iconos";
import { Lazo } from "./logotipo";
import type { Tema } from "./tema";

const OPCIONES = [
  { valor: "claro", etiqueta: "Claro", Icono: IconoSol },
  { valor: "oscuro", etiqueta: "Oscuro", Icono: IconoLuna },
  { valor: "lever", etiqueta: "Lever", Icono: () => <Lazo className="lazo icono" /> },
] as const;

/**
 * El tema dentro de un menú de la persona (Operación SOFIPO): tres opciones de radio del menú, la elegida con su
 * palomita. Las flechas del menú las recorren junto con las demás opciones; elegir una cambia el tema al momento.
 */
export function OpcionesTema({ inicial }: { inicial: Tema }) {
  const { tema } = useApariencia(undefined, inicial);
  return (
    <div role="group" aria-label="Tema" className="menu-grupo menu-tema">
      <p className="menu-seccion" aria-hidden="true">
        Tema
      </p>
      {OPCIONES.map(({ valor, etiqueta, Icono }) => (
        <button
          key={valor}
          type="button"
          role="menuitemradio"
          aria-checked={tema === valor}
          tabIndex={-1}
          className="menu-opcion"
          onClick={() => fijarTema(valor)}
          // El tema real puede venir del navegador (otra pestaña lo cambió): React no debe avisar al hidratar.
          suppressHydrationWarning
        >
          <Icono />
          {etiqueta}
          <span className="menu-marca" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
