import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
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
    <Marco actual="/entrar">
      <main id="contenido" className="entrada">
        <p className="kicker">Recuperar contraseña</p>
        {estado === "vigente" ? (
          <>
            <h1>Elige una contraseña nueva.</h1>
            <p className="lede">Al guardarla se cierran todas tus sesiones abiertas. El segundo factor no se borra.</p>
            <FormularioNuevaContrasena token={token} />
          </>
        ) : (
          <>
            <h1>{estado === "vencida" ? "El enlace venció." : "El enlace ya no sirve."}</h1>
            <p className="lede">Pide otro. Tu passkey y tu app autenticadora siguen igual.</p>
          </>
        )}
      </main>
    </Marco>
  );
}
