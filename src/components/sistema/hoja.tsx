import type { ReactNode } from "react";

/** La superficie de un bloque. `id` nombra el título para `aria-labelledby`. */
export function Hoja({
  id,
  titulo,
  className,
  children,
}: {
  id: string;
  titulo: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `hoja ${className}` : "hoja"} aria-labelledby={id}>
      <h2 id={id}>{titulo}</h2>
      {children}
    </section>
  );
}

/** Lista de etiqueta y valor. `dinero` alinea el valor a la derecha para los montos. */
export function Renglones({ dinero = false, children }: { dinero?: boolean; children: ReactNode }) {
  return <dl className={dinero ? "renglones renglones-dinero" : "renglones"}>{children}</dl>;
}

export function Renglon({ etiqueta, children }: { etiqueta: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>{etiqueta}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Lo que todavía no existe. No se disfraza de cero. */
export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <p className="vacio-titulo">{titulo}</p>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

/** Una regla fija del producto, dicha una vez. */
export function NotaRegla({ children }: { children: ReactNode }) {
  return <p className="nota-regla">{children}</p>;
}

export function Aviso({
  tono = "revisar",
  titulo,
  anunciar = true,
  children,
}: {
  tono?: "revisar" | "asentado";
  titulo: string;
  /** Sin región viva cuando otro elemento ya lo anuncia (el campo con el foco que lo lee como su descripción). */
  anunciar?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={tono === "asentado" ? "alerta alerta-asentado" : "alerta alerta-revisar"}
      role={anunciar ? (tono === "asentado" ? "status" : "alert") : undefined}
    >
      <p className="alerta-titulo">{titulo}</p>
      {children}
    </div>
  );
}
