import type { ReactNode } from "react";

import { MarcoOperacion } from "@/components/operacion/marco";
import { exigirContextoOperacion } from "@/server/operacion/contexto";
import { capacidadesDelPersonal } from "@/server/operacion/permisos";

import "@/estilo/operacion.css";

export const runtime = "nodejs";

export default async function LayoutOperacion({ children }: { children: ReactNode }) {
  const ctx = await exigirContextoOperacion();
  return (
    <MarcoOperacion personaId={ctx.persona.id} capacidades={capacidadesDelPersonal(ctx)}>
      {children}
    </MarcoOperacion>
  );
}
