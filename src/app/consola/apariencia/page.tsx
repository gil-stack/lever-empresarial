import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PanelApariencia } from "@/components/apariencia/panel";
import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { COOKIE_TEMA, temaDesde } from "@/components/cromo/tema";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Apariencia" };

/** Tema, fondo, tono y movimiento de cada persona. No cambia nada para nadie más. */
export default async function PaginaApariencia() {
  const apertura = await abrirRuta("/consola/apariencia");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const tema = temaDesde((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <Marco actual="/consola/apariencia" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <h1 className="solo-lector">Apariencia</h1>
        <PanelApariencia persona={ctx?.persona.id} tema={tema} empresa={ctx?.empresa?.razonSocial ?? null} />
      </main>
    </Marco>
  );
}
