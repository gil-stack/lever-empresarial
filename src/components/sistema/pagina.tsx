import type { ReactNode } from "react";

/** Kicker, título y entrada de una página. Va primero dentro de `.pagina` o `.consola`. */
export function CabezaPagina({
  kicker,
  titulo,
  children,
}: {
  kicker: string;
  titulo: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="pagina-cabeza">
      <p className="kicker">{kicker}</p>
      <h1>{titulo}</h1>
      {children}
    </header>
  );
}

/**
 * Columna ancha y columna angosta. Sin `lateral`, una sola columna.
 * `estable` mantiene las dos columnas por debajo de los 900 px del contenedor,
 * hasta 640 px: en una laptop el lienzo mide menos de 900 y las dos tienen que verse.
 */
export function Rejilla({
  principal,
  lateral,
  estable = false,
}: {
  principal: ReactNode;
  lateral?: ReactNode;
  estable?: boolean;
}) {
  const clases = ["rejilla"];
  if (!lateral) clases.push("rejilla-sola");
  else if (estable) clases.push("rejilla-estable");
  return (
    <div className={clases.join(" ")}>
      <div className="columna">{principal}</div>
      {lateral ? <div className="columna">{lateral}</div> : null}
    </div>
  );
}
