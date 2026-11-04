import type { ReactNode } from "react";

/** Un monto ya formateado en pesos. Mono tabular para que las cifras se alineen. */
export function Monto({ children }: { children: ReactNode }) {
  return <p className="monto">{children}</p>;
}

/** Una cifra que no existe todavía: «cifra no publicada», no `$0.00`. */
export function Ausencia({ children }: { children: ReactNode }) {
  return <p className="cifra-ausente">{children}</p>;
}

/** Un estado dicho en una frase, en la serif de los títulos. */
export function Frase({ children }: { children: ReactNode }) {
  return <p className="frase">{children}</p>;
}

export function Insignia({
  tono = "neutro",
  children,
}: {
  tono?: "neutro" | "sello" | "aviso";
  children: ReactNode;
}) {
  const clase = tono === "neutro" ? "insignia" : `insignia insignia-${tono}`;
  return <span className={clase}>{children}</span>;
}

/** RFC, CLABE o folio: nombre corto y valor en mono. */
export function EtiquetaMono({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <p className="etiqueta-mono">
      <span className="etiqueta-mono-nombre">{nombre}</span> {children}
    </p>
  );
}
