import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Seguridad } from "@/components/entrar/seguridad";
import { MarcoArco } from "@/components/entrar/marco-arco";
import { verFactores } from "@/server/autenticacion";
import { sesionDesdeCookie } from "@/server/entrada";
import { esOperadorActual } from "@/server/precio";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Segundo factor",
};

const AVISOS: Record<string, string> = {
  ultimo_factor: "Agrega otro método antes de quitar este. Sin segundo factor no se entra.",
  passkey_ausente: "Esa passkey ya no está.",
  totp_ausente: "No hay una app autenticadora activa.",
};

export default async function PaginaSeguridad({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const sesion = await sesionDesdeCookie();
  if (!sesion) redirect("/entrar?siguiente=/entrar/seguridad");
  const factores = await verFactores(sesion);
  const avisoParam = (await searchParams).aviso;
  const aviso = typeof avisoParam === "string" ? (AVISOS[avisoParam] ?? null) : null;
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
        esOperador={esOperadorActual(sesion)}
        aviso={aviso}
      />
    </MarcoArco>
  );
}
