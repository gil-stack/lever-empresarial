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

/** Tema en las superficies sin menú de la persona (entrada y Operación SOFIPO). */
export function SelectorTema({ inicial }: { inicial: Tema }) {
  const { tema } = useApariencia(undefined, inicial);

  return (
    <fieldset className="selector-tema">
      <legend>Tema</legend>
      <div className="selector-tema-opciones">
        {OPCIONES.map(({ valor, etiqueta, Icono }) => (
          <label key={valor} title={etiqueta}>
            <input
              type="radio"
              name="tema"
              value={valor}
              checked={tema === valor}
              onChange={() => fijarTema(valor)}
              // React avisa al hidratar un radio controlado: el navegador
              // restaura el marcado y no coincide con el HTML del servidor.
              suppressHydrationWarning
            />
            <Icono />
            <span>{etiqueta}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
