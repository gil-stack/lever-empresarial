import type { ReactNode } from "react";

import { formatoPesos } from "@/dominio/centavos";

/** Un monto ya formateado en pesos, en cifras tabulares para que se alineen. */
export function Monto({ children }: { children: ReactNode }) {
  return <p className="monto">{children}</p>;
}

/** La cifra principal de una pantalla: pesos grandes y centavos en pequeño. */
export function CifraGrande({ centavos }: { centavos: number }) {
  const texto = formatoPesos(centavos);
  const punto = texto.lastIndexOf(".");
  return (
    <p className="cifra-grande">
      <span className="cifra-entero">{texto.slice(0, punto)}</span>
      <span className="cifra-centavos">{texto.slice(punto)}</span>
    </p>
  );
}

/** Métricas en línea, separadas por un filete vertical. Cada hija es una `Metrica`. */
export function Metricas({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <dl className="metricas" aria-label={etiqueta}>
      {children}
    </dl>
  );
}

export function Metrica({ rotulo, nota, children }: { rotulo: string; nota?: ReactNode; children: ReactNode }) {
  return (
    <div className="metrica">
      <dt className="rotulo">{rotulo}</dt>
      <dd>
        {children}
        {nota ? <p className="pista">{nota}</p> : null}
      </dd>
    </div>
  );
}

/** Una cifra que no existe todavía: «cifra no publicada», no `$0.00`. */
export function Ausencia({ children }: { children: ReactNode }) {
  return <p className="cifra-ausente">{children}</p>;
}

/** Un estado dicho en una frase. */
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

/** Avance contra un tope (diseño .bar): coral; ámbar desde el 85 %; rojo al pasarse. */
export function BarraAvance({ valor, tope, etiqueta }: { valor: number; tope: number; etiqueta: string }) {
  const proporcion = tope > 0 ? valor / tope : 0;
  const clase = proporcion > 1 ? "barra-avance barra-avance-excedida" : proporcion >= 0.85 ? "barra-avance barra-avance-alta" : "barra-avance";
  return (
    <div className={clase} role="meter" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={tope} aria-valuenow={Math.min(valor, tope)}>
      <i style={{ width: `${Math.min(100, Math.max(0, proporcion * 100))}%` }} />
    </div>
  );
}
