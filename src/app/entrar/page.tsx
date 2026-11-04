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
  recuperacion: "Si el correo tiene cuenta, el enlace ya va en camino. El segundo factor no cambia.",
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
      <p className="arco-nota">
        El correo y la contraseña no abren el portal. La sesión nace con una passkey, un código de la app o un código de
        respaldo.
      </p>
      <FormularioEntrar siguiente={destino} aviso={aviso} />
    </MarcoArco>
  );
}
