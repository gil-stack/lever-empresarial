import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { SelectorTema } from "@/components/cromo/selector-tema";
import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";
import { LogoArco } from "@/components/landing/logo-arco";

/** La puerta de las tres superficies. No usa el menú de la consola ni el del teléfono. */
export async function MarcoArco({ children }: { children: ReactNode }) {
  const tema = temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <div className="arco">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <header className="arco-cabeza">
        <Link href="/" className="arco-marca" aria-label="LEVER Pagos, inicio">
          <LogoArco />
        </Link>
        <SelectorTema inicial={tema} />
      </header>
      <main id="contenido" className="arco-lienzo">
        <aside className="arco-presentacion" aria-label="La plataforma LEVER">
          <div className="arco-presentacion-copy">
            <p className="arco-eyebrow-acceso"><span aria-hidden="true" />Finanzas empresariales · México</p>
            <h2>Todo tu dinero.<br /><span>Un solo lugar.</span></h2>
            <p>
              Tarjetas, comprobantes y decisiones de finanzas en una plataforma diseñada para que tu empresa trabaje con
              claridad.
            </p>
          </div>
          <div className="arco-confianza">
            <p><span>01</span>Control para toda la empresa</p>
            <p><span>02</span>Seguridad en cada acceso</p>
            <p><span>03</span>Una sola versión de la verdad</p>
          </div>
          <p className="arco-firma">LEVER PAGOS <span aria-hidden="true" /> ACCESO SEGURO</p>
        </aside>
        <section className="arco-acceso-tarjeta">{children}</section>
      </main>
    </div>
  );
}
