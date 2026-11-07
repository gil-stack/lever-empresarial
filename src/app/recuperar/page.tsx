import type { Metadata } from "next";

import { MarcoArco } from "@/components/entrar/marco-arco";
import { FormularioPedirEnlace } from "@/components/recuperar/formularios";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  robots: { index: false, follow: false },
};

export default function PaginaRecuperar() {
  return (
    <MarcoArco>
      <p className="arco-kicker">Recuperar contraseña</p>
      <h1>Te mandamos un enlace.</h1>
      <p className="arco-nota">Escribe el correo con el que entras. El enlace sirve una sola vez y vence en una hora.</p>
      <FormularioPedirEnlace />
    </MarcoArco>
  );
}
