import type { Metadata } from "next";
import Link from "next/link";

import { MarcoArco } from "@/components/entrar/marco-arco";
import { FormularioNuevaContrasena } from "@/components/recuperar/formularios";
import { leerRecuperacion } from "@/server/invitaciones/recuperar";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Contraseña nueva",
  robots: { index: false, follow: false },
};

export default async function PaginaToken({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const estado = await leerRecuperacion(token);
  return (
    <MarcoArco>
      <p className="arco-kicker">Recuperar contraseña</p>
      {estado === "vigente" ? (
        <>
          <h1>Elige una contraseña nueva.</h1>
          <p className="arco-nota">Al guardarla se cierran todas tus sesiones. Tu segundo factor no cambia: te lo pedimos al entrar.</p>
          <FormularioNuevaContrasena token={token} />
        </>
      ) : (
        <>
          <h1>{estado === "vencida" ? "El enlace venció." : "El enlace ya no sirve."}</h1>
          <p className="arco-nota">Cada enlace sirve una vez y por una hora. Pide otro con tu correo.</p>
          <div className="acciones">
            <Link className="boton" href="/recuperar">
              Pedir otro enlace
            </Link>
          </div>
        </>
      )}
    </MarcoArco>
  );
}
