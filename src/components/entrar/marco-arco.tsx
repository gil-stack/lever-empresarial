import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { SelectorTema } from "@/components/cromo/selector-tema";
import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";

import { Banderin } from "./banderin";

/** La puerta de las tres superficies. No usa el menú de la consola ni el del teléfono. */
export async function MarcoArco({ children }: { children: ReactNode }) {
  const tema = temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <div className="arco">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <header className="arco-cabeza">
        <Banderin />
        <div className="arco-marca">
          <p className="arco-nombre">Arco</p>
          <p className="arco-frase">Todo tu dinero en un solo lugar</p>
        </div>
        <SelectorTema inicial={tema} />
      </header>
      <main id="contenido" className="arco-lienzo">
        <section className="arco-tarjeta">{children}</section>
      </main>
    </div>
  );
}
