export const COOKIE_TEMA = "tema";

export const TEMAS = ["auto", "claro", "oscuro"] as const;

export type Tema = (typeof TEMAS)[number];

/** Sin cookie, o con un valor ajeno, manda la preferencia del sistema. */
export function temaDesde(valor: string | undefined | null): Tema {
  return valor === "claro" || valor === "oscuro" ? valor : "auto";
}
