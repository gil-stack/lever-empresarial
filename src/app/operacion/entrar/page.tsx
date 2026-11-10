import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { MarcoArco } from "@/components/entrar/marco-arco";
import { FormularioEntrarOperacion } from "@/components/operacion/formulario-entrar";
import { deCatalogo } from "@/dominio/catalogo";
import { contextoOperacion } from "@/server/operacion/contexto";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Operación SOFIPO" };

/** Los que llegan por la URL desde el segundo factor; el rechazo de la contraseña lo trae el formulario. */
const AVISOS: Record<string, string> = {
  entrada_vencida: "La entrada venció. Vuelve a empezar.",
  entrada_agotada: "Demasiados intentos. Vuelve a escribir tu contraseña.",
};

export default async function PaginaEntrarOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  if (await contextoOperacion()) redirect("/operacion");
  const aviso = deCatalogo(AVISOS, (await soloTexto(searchParams)).aviso);
  return (
    <MarcoArco>
      <p className="arco-kicker">Personal SOFIPO</p>
      <h1>Operación de clientes.</h1>
      <p className="arco-nota">Entra con tu contraseña y tu segundo factor. La sesión sirve solo para Operación.</p>
      <FormularioEntrarOperacion aviso={aviso} />
    </MarcoArco>
  );
}
