import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FormularioEntrar } from "@/components/entrar/formulario-entrar";
import { MarcoArco } from "@/components/entrar/marco-arco";
import { deCatalogo } from "@/dominio/catalogo";
import { destinoSeguro, rutaDeDestino } from "@/server/autenticacion";
import { leerEntrada } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Entrar",
};

const AVISOS: Record<string, string> = {
  entrada_vencida: "Esa entrada venció. Vuelve a escribir tu contraseña.",
  entrada_agotada: "Demasiados intentos. Vuelve a escribir tu contraseña.",
  // Solo llega aquí tras pedir la recuperación del segundo factor: no sale ningún enlace, la revisa Operación
  // y al aprobarla se manda el aviso de seguridad `recuperacion_aprobada` (src/server/autenticacion/servicio.ts).
  recuperacion:
    "Tu solicitud quedó en revisión. Antes de aprobarla, el equipo de Lever confirma que eres tú. Te avisamos por correo cuando quede aprobada.",
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

  const aviso = deCatalogo(AVISOS, params.aviso);

  return (
    <MarcoArco>
      <p className="arco-kicker">Portal de clientes</p>
      <h1>Bienvenido de nuevo.</h1>
      <p className="arco-nota">Entra a la cuenta de tu empresa con tu correo y tu contraseña.</p>
      <FormularioEntrar siguiente={destino} aviso={aviso} />
    </MarcoArco>
  );
}
