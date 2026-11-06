import type { ClaveTema } from "./catalogo";

/**
 * El acento ya calculado de la persona (tono y tema), en una cookie para que el
 * servidor lo pinte desde el primer cuadro: sin ella, un tono distinto al de
 * inicio se aplicaba después de hidratar y los botones destellaban en coral.
 * Valor: `<persona>.<tema>.<acento>.<tinta>` con colores hex sin «#».
 */
export const COOKIE_ACENTO = "acento";

const HEX = /^[0-9a-f]{6}$/i;
const PERSONA = /^[0-9a-z-]{1,64}$/i;

export function valorAcentoGuardado(persona: string, tema: ClaveTema, acento: string, tinta: string): string | null {
  const a = acento.replace(/^#/, "");
  const t = tinta.replace(/^#/, "");
  if (!PERSONA.test(persona) || !HEX.test(a) || !HEX.test(t)) return null;
  return `${persona}.${tema}.${a}.${t}`;
}

/** Solo sirve si es de la misma persona y del tema que se va a pintar; si no, se queda el acento de inicio. */
export function leerAcentoGuardado(
  valor: string | undefined,
  persona: string | undefined,
  tema: ClaveTema,
): { acento: string; tinta: string } | null {
  if (!valor || !persona) return null;
  const [dePersona, deTema, acento, tinta] = valor.split(".");
  if (dePersona !== persona || deTema !== tema || !HEX.test(acento ?? "") || !HEX.test(tinta ?? "")) return null;
  return { acento: `#${acento}`, tinta: `#${tinta}` };
}
