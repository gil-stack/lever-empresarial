import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Seguridad } from "@/components/entrar/seguridad";
import { MarcoArco } from "@/components/entrar/marco-arco";
import { estadoDeConfirmacion, verFactores } from "@/server/autenticacion";
import { contextoOpcional, sesionDesdeCookie } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Segundo factor",
};

const AVISOS: Record<string, string> = {
  ultimo_factor: "Agrega otro método antes de quitar este. Sin segundo factor no se entra.",
  passkey_ausente: "Esa passkey ya no está.",
  totp_ausente: "No hay una app autenticadora activa.",
  reautenticacion_requerida:
    "Confirma que eres tú: cambiar tus métodos exige tu segundo factor de los últimos cinco minutos.",
};

export default async function PaginaSeguridad({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const sesion = await sesionDesdeCookie();
  if (!sesion) redirect("/entrar?siguiente=/entrar/seguridad");
  const [factores, confirmacion] = await Promise.all([verFactores(sesion), estadoDeConfirmacion(sesion)]);
  const avisoParam = (await searchParams).aviso;
  const aviso = typeof avisoParam === "string" ? (AVISOS[avisoParam] ?? null) : null;
  // Se regresa a la superficie con la que se abrió la sesión; la consola elige la empresa.
  const regreso =
    sesion.superficie === "sofipo"
      ? { href: "/operacion", texto: "Volver a Operación" }
      : sesion.superficie === "telefono"
        ? { href: "/telefono", texto: "Volver al teléfono" }
        : { href: "/consola", texto: "Volver a la consola" };
  const formato = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeZone: "America/Mexico_City",
  });

  return (
    <MarcoArco>
      <Seguridad
        passkeys={factores.passkeys.map((passkey) => ({
          id: passkey.id,
          nombre: passkey.nombre,
          creadaEn: formato.format(passkey.creadaEn),
          ultimoUsoEn: passkey.ultimoUsoEn ? formato.format(passkey.ultimoUsoEn) : null,
        }))}
        totp={factores.totp}
        respaldoRestantes={factores.respaldoRestantes}
        confirmacion={confirmacion}
        esOperador={Boolean((await contextoOpcional())?.personal)}
        aviso={aviso}
        regreso={regreso}
      />
    </MarcoArco>
  );
}
