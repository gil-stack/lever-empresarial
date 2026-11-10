import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { AparienciaViva } from "@/components/apariencia/viva";
import { Logotipo } from "@/components/cromo/logotipo";
import { SelectorTema } from "@/components/cromo/selector-tema";
import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";

/** La puerta de las tres superficies. No usa el menú de la consola ni el del teléfono. */
export async function MarcoArco({ children }: { children: ReactNode }) {
  const tema = temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <>
      <AparienciaViva tema={tema} />
      <div className="arco">
        <a className="saltar" href="#contenido">
          Saltar al contenido
        </a>
        <header className="arco-cabeza">
          {/* El nombre sale del contenido, como el del portal: un aria-label no contendría el texto que se ve. */}
          <Link href="/" className="arco-marca">
            <Logotipo decorativo />
            <span className="solo-lector">Lever Empresas, inicio</span>
          </Link>
          <SelectorTema inicial={tema} />
        </header>
        <main id="contenido" className="arco-lienzo">
          <section className="arco-acceso-tarjeta">{children}</section>
        </main>
        <footer className="arco-pie-pagina">Acceso seguro a tu empresa</footer>
      </div>
    </>
  );
}
