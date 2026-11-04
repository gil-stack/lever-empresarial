import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { FormularioInvitacion } from "@/components/invitacion/formulario-invitacion";
import { CabezaPagina } from "@/components/sistema";
import { leerInvitacion, type VistaDeInvitacion } from "@/server/invitaciones";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Invitación",
  referrer: "no-referrer",
};

export default async function PaginaInvitacion({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const vista = await leer(token);

  return (
    <Marco actual="/invitacion">
      <main id="contenido" className="entrada">
        <p className="kicker">Invitación</p>
        {vista.estado === "vigente" ? (
          <>
            <h1>{vista.razonSocial ? `Te invitaron a ${vista.razonSocial}.` : "Te invitaron a la plataforma."}</h1>
            <p className="lede">
              {vista.yaTieneContrasena
                ? `Ya tienes cuenta como ${vista.correo}. Confirma con tu contraseña.`
                : `Fija tu contraseña para ${vista.correo}. Nadie más la conoce.`}{" "}
              Después verificas tu segundo factor.
            </p>
            <FormularioInvitacion token={token} yaTieneContrasena={vista.yaTieneContrasena} />
          </>
        ) : (
          <CabezaPagina kicker="Invitación" titulo={TITULOS[vista.estado]}>
            <p className="lede">{DETALLES[vista.estado]}</p>
            <div className="acciones">
              <Link className="boton" href="/entrar">
                Entrar
              </Link>
            </div>
          </CabezaPagina>
        )}
      </main>
    </Marco>
  );
}

async function leer(token: string): Promise<VistaDeInvitacion | { estado: "libro" }> {
  try {
    return await leerInvitacion(token);
  } catch (error) {
    if (error instanceof ErrorDeDominio) return { estado: "libro" };
    throw error;
  }
}

const TITULOS = {
  usada: "Esta invitación ya se usó.",
  vencida: "Esta invitación venció.",
  revocada: "Esta invitación ya no sirve.",
  inexistente: "Este enlace no es una invitación.",
  libro: "No se pudo abrir la invitación.",
} as const;

const DETALLES = {
  usada: "Si ya fijaste tu contraseña, entra con tu correo.",
  vencida: "Pide otra a quien te invitó. Cada enlace sirve una vez y por poco tiempo.",
  revocada: "Hay una invitación más nueva en tu correo, o pide otra a quien te invitó.",
  inexistente: "Revisa que el enlace esté completo.",
  libro: "Vuelve a intentar en un momento.",
} as const;
