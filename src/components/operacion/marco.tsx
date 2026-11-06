import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { AcentoInicial } from "@/components/apariencia/acento-inicial";
import { AparienciaViva } from "@/components/apariencia/viva";
import { LateralMovil } from "@/components/cromo/lateral-movil";
import { Logotipo } from "@/components/cromo/logotipo";
import { SelectorTema } from "@/components/cromo/selector-tema";
import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";

import { NavegacionOperacion } from "./navegacion";

/**
 * El marco de Operación SOFIPO es el de la consola: escena detrás, lateral con
 * secciones (cajón en pantallas angostas) y lienzo. La barra de arriba la pone
 * cada página (`PaginaOperacion`), con su título y su acción.
 */
export async function MarcoOperacion({ personaId, children }: { personaId: string; children: ReactNode }) {
  const tema = temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
  const marca = (
    <Link href="/operacion" className="marca" aria-label="Lever Operación SOFIPO, ir al resumen">
      <Logotipo linea="Operación SOFIPO" />
    </Link>
  );
  return (
    <>
      <AcentoInicial persona={personaId} tema={tema} />
      <AparienciaViva persona={personaId} tema={tema} />
      <div className="marco">
        <a className="saltar" href="#contenido">
          Saltar al contenido
        </a>
        <LateralMovil marca={marca}>
          <div className="lateral-cabeza">{marca}</div>
          <NavegacionOperacion />
          <div className="operacion-lateral-pie">
            <SelectorTema inicial={tema} />
          </div>
        </LateralMovil>
        <div className="lienzo">{children}</div>
      </div>
    </>
  );
}
