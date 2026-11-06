import type { Metadata } from "next";
import Link from "next/link";

import { LogoLever } from "@/components/landing/logo-lever";

export const metadata: Metadata = {
  title: "Página no encontrada",
  robots: { index: false, follow: false },
};

/** La página que no existe, con la marca y en español. Nunca dice si la ruta existe para otra persona. */
export default function NoEncontrada() {
  return (
    <main id="contenido" className="consola no-encontrada">
      <Link href="/" className="no-encontrada-marca" aria-label="LEVER, inicio">
        <LogoLever />
      </Link>
      <p className="kicker">Error 404</p>
      <h1>No encontramos esta página.</h1>
      <p className="lede">El enlace puede estar mal escrito, ya no existir o pertenecer a otra cuenta.</p>
      <div className="acciones">
        <Link className="boton" href="/entrar">
          Entrar a mi cuenta
        </Link>
        <Link className="boton-texto" href="/">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
