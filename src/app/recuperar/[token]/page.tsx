import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { FormularioContrasenaNueva } from "@/components/recuperar/formularios";
import { leerRecuperacion, type EstadoRecuperacion } from "@/server/invitaciones";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contraseña nueva",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function PaginaContrasenaNueva({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const estado = await leerSinRomper(token);

  return (
    <Marco actual="/entrar">
      <main id="contenido" className="entrada">
        <p className="kicker">Recuperar contraseña</p>
        {estado === "vigente" ? (
          <>
            <h1>Elige una contraseña nueva.</h1>
            <p className="lede">
              Solo tú la conoces. Tu segundo factor no cambia: te lo pedimos al entrar.
            </p>
            <FormularioContrasenaNueva token={token} />
          </>
        ) : (
          <>
            <h1>{estado === "vencida" ? "El enlace venció." : "Este enlace ya no sirve."}</h1>
            <p className="lede">
              {estado === null
                ? "El servicio no respondió. Vuelve a abrir el enlace en unos minutos."
                : "Cada enlace sirve una vez y dura una hora. Pide uno nuevo."}
            </p>
            <div className="acciones">
              <Link className="boton" href="/recuperar">
                Pedir otro enlace
              </Link>
            </div>
          </>
        )}
      </main>
    </Marco>
  );
}

async function leerSinRomper(token: string): Promise<EstadoRecuperacion | null> {
  try {
    return await leerRecuperacion(token);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return null;
    throw error;
  }
}
