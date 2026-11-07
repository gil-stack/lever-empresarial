import type { ReactNode } from "react";

import "@/estilo/demo.css";

/**
 * La página de un módulo del diseño: un solo h1 (el título visible vive en la
 * barra superior del marco) y la hoja de estilos de los módulos.
 */
export function ModuloDiseno({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main id="contenido" className="pagina modulo-diseno">
      <h1 className="solo-lector">{titulo}</h1>
      {children}
    </main>
  );
}
