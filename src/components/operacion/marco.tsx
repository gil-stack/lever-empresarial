import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";

import { salirOperacion } from "@/app/operacion/acciones";
import { Banderin, PalabraArco } from "@/components/cromo/logotipo";
import { SelectorTema } from "@/components/cromo/selector-tema";
import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";

const SECCIONES = [
  ["/operacion", "Resumen"],
  ["/operacion/clientes", "Clientes"],
  ["/operacion/aprobaciones", "Aprobaciones"],
  ["/operacion/alertas", "Alertas"],
  ["/operacion/comisiones", "Comisiones"],
  ["/operacion/bitacora", "Bitácora"],
] as const;

export async function MarcoOperacion({ actual, nombre, children }: { actual: string; nombre: string; children: ReactNode }) {
  const tema = temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <div className="operacion-marco">
      <a className="saltar" href="#contenido">Saltar al contenido</a>
      <aside className="operacion-lateral">
        <Link href="/operacion" className="marca" aria-label="Arco Operación, ir al resumen">
          <Banderin /><span className="marca-texto"><PalabraArco /><span className="marca-linea">Operación SOFIPO</span></span>
        </Link>
        <nav className="operacion-nav" aria-label="Operación">
          {SECCIONES.map(([ruta, etiqueta]) => <Link key={ruta} href={ruta} aria-current={actual === ruta ? "page" : undefined}>{etiqueta}</Link>)}
        </nav>
        <div className="operacion-cuenta">
          <SelectorTema inicial={tema} />
          <p><strong>{nombre}</strong><span>Personal de plataforma</span></p>
          <form action={salirOperacion}><button className="boton-texto" type="submit">Salir</button></form>
        </div>
      </aside>
      <div className="operacion-lienzo">{children}<footer className="operacion-pie">Activación para el portal, nunca autorización de dinero, KYB o PLD.</footer></div>
    </div>
  );
}
