import type { ReactNode } from "react";

import { MarcoOperacion } from "@/components/operacion/marco";
import { exigirContextoOperacion } from "@/server/operacion/contexto";

import "@/estilo/operacion.css";

export const runtime = "nodejs";

export default async function LayoutOperacion({ children }: { children: ReactNode }) {
  const ctx = await exigirContextoOperacion();
  return <MarcoOperacion actual="/operacion" nombre={ctx.persona.nombre}>{children}</MarcoOperacion>;
}
