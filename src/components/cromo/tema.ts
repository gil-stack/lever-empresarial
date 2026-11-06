import { esTema, type ClaveTema } from "@/components/apariencia/catalogo";

export const COOKIE_TEMA = "tema";

export type Tema = ClaveTema;

/** El color de fondo (`--void`) de cada tema, para la barra del navegador. */
export const FONDO_DEL_TEMA: Readonly<Record<Tema, string>> = {
  oscuro: "#0e0a08",
  claro: "#ece6de",
  lever: "#5e1c15",
};

/**
 * El diseño no tiene «Sistema»: sin cookie, con la vieja «auto» o con un valor
 * ajeno manda Oscuro, el tema por defecto. «claro» y «oscuro» guardados antes
 * siguen valiendo tal cual.
 */
export function temaDesde(valor: string | undefined | null): Tema {
  return esTema(valor) ? valor : "oscuro";
}
