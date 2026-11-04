import type { ReactNode } from "react";

import { AvisoOperacion } from "./aviso";

export function PaginaOperacion({ titulo, descripcion, aviso, children }: { titulo: string; descripcion: string; aviso?: string; children: ReactNode }) {
  return (
    <main id="contenido" className="operacion-pagina">
      <header className="operacion-cabeza"><p className="kicker">Operación SOFIPO</p><h1>{titulo}</h1><p className="lede">{descripcion}</p></header>
      <AvisoOperacion codigo={aviso} />
      {children}
    </main>
  );
}
