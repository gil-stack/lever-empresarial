import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MarcoArco } from "@/components/entrar/marco-arco";
import { destinoDespuesDeEntrar } from "@/server/autenticacion";
import { contextoDePeticion } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Abrir portal" };

export default async function PaginaDestino({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string }>;
}) {
  const params = await searchParams;
  const resuelto = await contextoDePeticion("cliente");
  if (!resuelto) redirect("/entrar");
  if (resuelto === "libro") {
    return (
      <MarcoArco>
        <p className="arco-kicker">Abrir portal</p>
        <h1>No se pudo resolver tu empresa.</h1>
        <p className="arco-nota">Tu segundo factor no cambia. Vuelve a intentar para consultar tus membresías.</p>
        <p><Link className="boton" href="/entrar/destino">Reintentar</Link></p>
      </MarcoArco>
    );
  }
  redirect(destinoDespuesDeEntrar(resuelto.ctx.empresas, params.siguiente));
}
