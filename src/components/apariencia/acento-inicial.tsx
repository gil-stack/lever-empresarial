import { cookies, headers } from "next/headers";

import { CABECERA_NONCE } from "@/nucleo/csp";

import type { ClaveTema } from "./catalogo";
import { COOKIE_ACENTO, leerAcentoGuardado } from "./acento-guardado";

/**
 * Pinta desde el servidor el acento que la persona ya eligió, antes del contenido,
 * para que el primer cuadro no salga con el coral de inicio. Los valores ya vienen
 * validados como hex; el tema, del catálogo. Lleva el nonce de la petición: la
 * política de contenido no deja pasar un <style> sin él.
 *
 * Solo en la carga del documento. En una navegación del cliente o una acción de
 * servidor el <style> llegaría con el nonce de esa petición, no con el del
 * documento, y la política lo bloquearía; ahí ya no hace falta, porque
 * AparienciaViva dejó el acento en <html> al hidratar. Sin el encabezado
 * (navegadores viejos) se pinta, como antes.
 */
export async function AcentoInicial({ persona, tema }: { persona?: string; tema: ClaveTema }) {
  const cabeceras = await headers();
  const destino = cabeceras.get("sec-fetch-dest");
  if (destino && destino !== "document") return null;
  const guardado = leerAcentoGuardado((await cookies()).get(COOKIE_ACENTO)?.value, persona, tema);
  if (!guardado) return null;
  return <style nonce={cabeceras.get(CABECERA_NONCE) ?? undefined}>{`:root[data-tema="${tema}"]{--acc:${guardado.acento};--ink:${guardado.tinta}}`}</style>;
}
