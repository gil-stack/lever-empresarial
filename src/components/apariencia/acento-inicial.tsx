import { cookies } from "next/headers";

import type { ClaveTema } from "./catalogo";
import { COOKIE_ACENTO, leerAcentoGuardado } from "./acento-guardado";

/**
 * Pinta desde el servidor el acento que la persona ya eligió, antes del contenido,
 * para que el primer cuadro no salga con el coral de inicio. Los valores ya vienen
 * validados como hex; el tema, del catálogo.
 */
export async function AcentoInicial({ persona, tema }: { persona?: string; tema: ClaveTema }) {
  const guardado = leerAcentoGuardado((await cookies()).get(COOKIE_ACENTO)?.value, persona, tema);
  if (!guardado) return null;
  return <style>{`:root[data-tema="${tema}"]{--acc:${guardado.acento};--ink:${guardado.tinta}}`}</style>;
}
