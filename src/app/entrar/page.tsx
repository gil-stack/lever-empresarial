import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FormularioEntrar } from "@/components/entrar/formulario-entrar";
import { MarcoArco } from "@/components/entrar/marco-arco";
import { destinoSeguro } from "@/server/autenticacion";
import { leerEntrada } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Entrar",
};

const AVISOS: Record<string, string> = {
  entrada_vencida: "Esa entrada venció. Vuelve a escribir tu contraseña.",
  entrada_agotada: "Demasiados intentos. Vuelve a escribir tu contraseña.",
  recuperacion:
    "Recibimos la solicitud. Alguien del equipo va a verificar tu identidad. Hasta entonces la cuenta sigue cerrada.",
};

export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string; aviso?: string }>;
}) {
  const params = await searchParams;
  const destino = destinoSeguro(params.siguiente);
  const entrada = await leerEntrada();
  if (entrada.nombre) redirect(destino);

  const aviso = typeof params.aviso === "string" ? (AVISOS[params.aviso] ?? null) : null;

  return (
    <MarcoArco>
      <p className="arco-kicker">Entrar</p>
      <h1>Correo, contraseña y un segundo factor.</h1>
      <p className="arco-nota">Así se entra a la SOFIPO, a la empresa y al teléfono. Sin el segundo factor no se abre nada.</p>
      <FormularioEntrar siguiente={destino} aviso={aviso} />
    </MarcoArco>
  );
}
