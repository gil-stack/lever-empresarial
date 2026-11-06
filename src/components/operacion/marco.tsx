import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { salirOperacion } from "@/app/operacion/acciones";
import { AcentoInicial } from "@/components/apariencia/acento-inicial";
import { AparienciaViva } from "@/components/apariencia/viva";
import { Logotipo } from "@/components/cromo/logotipo";
import { SelectorTema } from "@/components/cromo/selector-tema";
import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";

import { NavegacionOperacion } from "./navegacion";

export async function MarcoOperacion({ nombre, personaId, children }: { nombre: string; personaId: string; children: ReactNode }) {
  const tema = temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <>
      <AcentoInicial persona={personaId} tema={tema} />
      <AparienciaViva persona={personaId} tema={tema} />
      <div className="operacion-marco">
        <a className="saltar" href="#contenido">Saltar al contenido</a>
        <aside className="operacion-lateral">
          <Link href="/operacion" className="marca" aria-label="Lever Operación SOFIPO, ir al resumen">
            <Logotipo linea="Operación SOFIPO" />
          </Link>
          <NavegacionOperacion />
          <div className="operacion-cuenta">
            <SelectorTema inicial={tema} />
            <p><strong>{nombre}</strong><span>Personal de plataforma</span></p>
            <form action={salirOperacion}><button className="boton-texto" type="submit">Salir</button></form>
          </div>
        </aside>
        <div className="operacion-lienzo">{children}<footer className="operacion-pie">Activación para el portal, nunca autorización de dinero, KYB o PLD.</footer></div>
      </div>
    </>
  );
}
