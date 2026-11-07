import type { Metadata } from "next";
import Link from "next/link";

import { MarcoArco } from "@/components/entrar/marco-arco";

export const metadata: Metadata = {
  title: "Página no encontrada",
  robots: { index: false, follow: false },
};

/** La página que no existe, en la misma puerta que la entrada. Nunca dice si la ruta existe para otra persona. */
export default function NoEncontrada() {
  return (
    <MarcoArco>
      <p className="arco-kicker">Error 404</p>
      <h1>No encontramos esta página.</h1>
      <p className="arco-nota">El enlace puede estar mal escrito, ya no existir o ser de otra cuenta.</p>
      <div className="acciones">
        <Link className="boton" href="/entrar">
          Entrar a mi cuenta
        </Link>
        <Link className="boton-texto" href="/">
          Ir al inicio
        </Link>
      </div>
    </MarcoArco>
  );
}
