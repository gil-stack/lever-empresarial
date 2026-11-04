import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { FormularioPedirEnlace } from "@/components/recuperar/formularios";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  robots: { index: false, follow: false },
};

export default function PaginaRecuperar() {
  return (
    <Marco actual="/entrar">
      <main id="contenido" className="entrada">
        <p className="kicker">Recuperar contraseña</p>
        <h1>Te mandamos un enlace.</h1>
        <p className="lede">Escribe tu correo. El enlace sirve una sola vez y vence en una hora.</p>
        <FormularioPedirEnlace />
      </main>
    </Marco>
  );
}
