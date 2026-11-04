import type { ReactNode } from "react";

import {
  IconoAlta,
  IconoConsola,
  IconoPersonas,
  IconoPolitica,
  IconoPoliza,
  IconoPrecios,
} from "./iconos";

export type Seccion = { href: string; etiqueta: string; Icono: () => ReactNode };
export type GrupoDeSecciones = { titulo: string; secciones: Seccion[] };

/**
 * La navegación lateral entera. Una sección nueva entra aquí, con su ícono en
 * iconos.tsx; las puertas por rol llegan de `puertasDe` y no se deciden aquí.
 */
export function seccionesDe({ maestro, poliza }: { maestro: boolean; poliza: boolean }): GrupoDeSecciones[] {
  return [
    {
      titulo: "Operación",
      secciones: [
        { href: "/consola", etiqueta: "Consola", Icono: IconoConsola },
        { href: "/consola/politica", etiqueta: "Política", Icono: IconoPolitica },
        ...(maestro ? [{ href: "/consola/personas", etiqueta: "Personas", Icono: IconoPersonas }] : []),
        ...(poliza ? [{ href: "/consola/poliza", etiqueta: "Póliza", Icono: IconoPoliza }] : []),
      ],
    },
    {
      titulo: "Cuenta",
      secciones: [
        { href: "/", etiqueta: "Alta", Icono: IconoAlta },
        { href: "/precios", etiqueta: "Precios", Icono: IconoPrecios },
      ],
    },
  ];
}
