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

/** Columna ancha para el dinero y columna angosta para el estado. Sin `lateral`, una sola columna. */
export function Rejilla({ principal, lateral }: { principal: ReactNode; lateral?: ReactNode }) {
  return (
    <div className={lateral ? "rejilla" : "rejilla rejilla-sola"}>
      <div className="columna">{principal}</div>
      {lateral ? <div className="columna">{lateral}</div> : null}
    </div>
  );
}
