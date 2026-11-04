import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { FormularioAceptar } from "@/components/invitacion/formulario-aceptar";
import { leerInvitacion, type LecturaInvitacion } from "@/server/invitaciones";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invitación",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const ROLES: Readonly<Record<string, string>> = {
  administrador: "Administrador",
  solicitante: "Solicitante",
  liberador: "Liberador",
  tarjetahabiente: "Tarjetahabiente",
  contador: "Contador",
};

export default async function PaginaInvitacion({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lectura = await leerSinRomper(token);

  return (
    <Marco actual="/invitacion">
      <main id="contenido" className="entrada">
        <p className="kicker">Invitación</p>
        {lectura === null ? (
          <>
            <h1>No pudimos abrir la invitación.</h1>
            <p className="lede">El servicio no respondió. Vuelve a abrir el enlace en unos minutos.</p>
          </>
        ) : lectura.estado === "vigente" ? (
          <>
            <h1>Hola, {lectura.nombre}.</h1>
            <p className="lede">
              {lectura.quienInvita ?? "La administración"} te invitó a {lectura.razonSocial} como{" "}
              {lectura.roles.map((rol) => ROLES[rol] ?? rol).join(", ").toLowerCase()}.{" "}
              {lectura.cuentaExistente
                ? "Confirma con tu contraseña para sumarte; después te pedimos tu segundo factor."
                : "Elige tu contraseña y después registra tu segundo factor: una passkey o una app de códigos."}
            </p>
            <FormularioAceptar token={token} correo={lectura.correo} cuentaExistente={lectura.cuentaExistente} />
          </>
        ) : lectura.estado === "vencida" ? (
          <>
            <h1>La invitación venció.</h1>
            <p className="lede">Por seguridad, cada enlace dura poco. Pide a quien te invitó que la envíe de nuevo.</p>
          </>
        ) : (
          <>
            <h1>Este enlace ya no sirve.</h1>
            <p className="lede">
              Se usó, se revocó o no existe. Si ya elegiste tu contraseña, entra con tu correo.
            </p>
          </>
        )}
      </main>
    </Marco>
  );
}

async function leerSinRomper(token: string): Promise<LecturaInvitacion | null> {
  try {
    return await leerInvitacion(token);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return null;
    throw error;
  }
}
