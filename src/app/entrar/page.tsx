import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FormularioEntrar } from "@/components/entrar/formulario-entrar";
import { MarcoArco } from "@/components/entrar/marco-arco";
import { destinoSeguro, rutaDeDestino } from "@/server/autenticacion";
import { leerEntrada } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Entrar",
};

const AVISOS: Record<string, string> = {
  entrada_vencida: "Esa entrada venció. Vuelve a escribir tu contraseña.",
  entrada_agotada: "Demasiados intentos. Vuelve a escribir tu contraseña.",
  // Solo llega aquí tras pedir la recuperación del segundo factor: no sale ningún enlace, la revisa Operación.
  recuperacion:
    "Tu solicitud quedó en revisión. Lever confirma tu identidad por videollamada o en persona antes de aprobarla; los factores que ya tienes no cambian.",
};

export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string; aviso?: string }>;
}) {
  const params = await searchParams;
  const destino = destinoSeguro(params.siguiente);
  const entrada = await leerEntrada();
  if (entrada.nombre) redirect(rutaDeDestino(destino));

  const aviso = typeof params.aviso === "string" ? (AVISOS[params.aviso] ?? null) : null;

  return (
    <MarcoArco>
      <p className="arco-kicker">Portal de clientes</p>
      <h1>Bienvenido de nuevo.</h1>
      <p className="arco-nota">
        Entra a la cuenta de tu empresa. Después de validar tu correo y contraseña, te pediremos un segundo factor.
      </p>
      <FormularioEntrar siguiente={destino} aviso={aviso} />
    </MarcoArco>
  );
}
