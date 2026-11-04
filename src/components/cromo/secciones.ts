import type { ReactNode } from "react";

import {
  IconoAlta,
  IconoConsola,
  IconoLista,
  IconoPersonas,
  IconoPolitica,
  IconoPoliza,
  IconoPrecios,
  IconoProveedores,
} from "./iconos";

export type Seccion = { href: string; etiqueta: string; Icono: () => ReactNode };
export type GrupoDeSecciones = { titulo: string; secciones: Seccion[] };

/** Un pendiente real de una sección. Sin pendiente, la sección no lleva número. */
export type Contador = { valor: number; etiqueta: string };

/**
 * La navegación lateral entera. Una sección nueva entra aquí, con su ícono en
 * iconos.tsx; las puertas por rol llegan de `puertasDe` y no se deciden aquí.
 * El título de cada grupo lo lee el lector de pantalla; a la vista los separa un filete.
 */
export function seccionesDe({
  maestro,
  poliza,
  proveedores = false,
  lista69b = false,
}: {
  maestro: boolean;
  poliza: boolean;
  proveedores?: boolean;
  lista69b?: boolean;
}): GrupoDeSecciones[] {
  return [
    {
      titulo: "Operación",
      secciones: [
        { href: "/consola", etiqueta: "Resumen", Icono: IconoConsola },
        { href: "/consola/politica", etiqueta: "Política", Icono: IconoPolitica },
        ...(proveedores
          ? [{ href: "/consola/proveedores", etiqueta: "Proveedores", Icono: IconoProveedores }]
          : []),
        ...(lista69b ? [{ href: "/consola/lista-69b", etiqueta: "Lista 69-B", Icono: IconoLista }] : []),
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
