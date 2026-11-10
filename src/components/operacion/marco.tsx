import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { AcentoInicial } from "@/components/apariencia/acento-inicial";
import { AparienciaViva } from "@/components/apariencia/viva";
import { LateralMovil } from "@/components/cromo/lateral-movil";
import { Logotipo } from "@/components/cromo/logotipo";
import { SelectorTema } from "@/components/cromo/selector-tema";
import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";

import { idDeAncla } from "./envio-sin-script";
import { NavegacionOperacion } from "./navegacion";

/**
 * El marco de Operación SOFIPO es el de la consola: escena detrás, lateral con
 * secciones (cajón en pantallas angostas) y lienzo. La barra de arriba la pone
 * cada página (`PaginaOperacion`), con su título y su acción.
 */
export async function MarcoOperacion({
  personaId,
  capacidades,
  children,
}: {
  personaId: string;
  capacidades: readonly string[];
  children: ReactNode;
}) {
  const [almacen, destino] = await Promise.all([cookies(), idDeAncla("contenido")]);
  const tema = temaDesde(almacen.get(COOKIE_TEMA)?.value);
  return (
    <>
      <AcentoInicial persona={personaId} tema={tema} />
      <AparienciaViva persona={personaId} tema={tema} />
      <div className="marco">
        {/* El destino es el `main` de PaginaOperacion; sin JavaScript, tras un envío lleva sufijo (idDeAncla). */}
        <a className="saltar" href={`#${destino}`}>
          Saltar al contenido
        </a>
        {/* Dos marcas, no el mismo elemento dos veces: el servidor lo mandaría una sola vez y los dos
            lazos compartirían el id de su degradado, que vive en el de la barra móvil, oculta en escritorio. */}
        <LateralMovil marca={<Marca />}>
          <div className="lateral-cabeza">
            <Marca />
          </div>
          <NavegacionOperacion capacidades={capacidades} />
          <div className="operacion-lateral-pie">
            <SelectorTema inicial={tema} />
          </div>
        </LateralMovil>
        <div className="lienzo">{children}</div>
      </div>
    </>
  );
}

function Marca() {
  return (
    <Link href="/operacion" className="marca">
      {/* El nombre lo lleva un solo texto para el lector: el logotipo es flexible y, junto a otro texto, el nombre
          quedaba «Lever Operación SOFIPO , ir al resumen». Sin aria-label, el nombre contiene lo que se ve (WCAG 2.5.3). */}
      <span aria-hidden="true">
        <Logotipo linea="Operación SOFIPO" />
      </span>
      <span className="solo-lector">Lever Operación SOFIPO, ir al resumen</span>
    </Link>
  );
}
