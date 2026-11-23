import type { ReactNode } from "react";

import { MarcoOperacion } from "@/components/operacion/marco";
import { exigirContextoOperacion } from "@/server/operacion/contexto";
import { capacidadesDelPersonal } from "@/server/operacion/permisos";
import { ETIQUETA_ROL_PLATAFORMA } from "@/server/operacion/personal";

import "@/estilo/operacion.css";

export const runtime = "nodejs";

export default async function LayoutOperacion({ children }: { children: ReactNode }) {
  const ctx = await exigirContextoOperacion();
  const rol = ctx.personal.roles.map((clave) => ETIQUETA_ROL_PLATAFORMA[clave]).join(" · ") || "Personal de Lever";
  return (
    <MarcoOperacion personaId={ctx.persona.id} nombre={ctx.persona.nombre} rol={rol} capacidades={capacidadesDelPersonal(ctx)}>
      {children}
    </MarcoOperacion>
  );
}
