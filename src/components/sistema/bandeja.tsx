"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type Decision = {
  id: string;
  /** «Tipo · Persona», en una línea. */
  titulo: string;
  icono?: ReactNode;
  /** Monto, motivo y origen. */
  detalle: ReactNode;
  /** Lo que ayuda a decidir: cuánto lleva gastado, quién más la revisó. */
  contexto?: ReactNode[];
  /** Los botones de la fila. Rechazar lleva `data-atajo="rechazar"` y aprobar `data-atajo="aprobar"`. */
  acciones: ReactNode;
};

const CAMPOS_DE_TEXTO = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * «Necesita tu decisión». Los atajos solo escuchan cuando el foco está dentro de la bandeja:
 * A aprueba y R rechaza la fila con foco; las flechas mueven entre filas.
 * Sin `aprobarSeleccionadas` no hay casillas ni aprobación en lote.
 */
export function Bandeja({
  decisiones,
  vacio,
  aprobarSeleccionadas,
}: {
  decisiones: Decision[];
  vacio: ReactNode;
  aprobarSeleccionadas?: (ids: string[]) => void | Promise<void>;
}) {
  const [activa, setActiva] = useState(0);
  const [elegidas, setElegidas] = useState<ReadonlySet<string>>(new Set());
  const ids = decisiones.map((decision) => decision.id).join("\n");
  useEffect(() => {
    setElegidas((antes) => {
      const vivas = new Set(ids.split("\n").filter(Boolean));
      const despues = new Set([...antes].filter((id) => vivas.has(id)));
      return despues.size === antes.size ? antes : despues;
    });
  }, [ids]);
  const filas = useRef<(HTMLLIElement | null)[]>([]);
  const conLote = Boolean(aprobarSeleccionadas) && decisiones.length > 0;
  const todas = decisiones.length > 0 && decisiones.every((decision) => elegidas.has(decision.id));

  function enfocar(indice: number) {
    const destino = Math.max(0, Math.min(decisiones.length - 1, indice));
    setActiva(destino);
    filas.current[destino]?.focus();
  }

  function alTeclear(evento: KeyboardEvent<HTMLUListElement>) {
    if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
    const objetivo = evento.target as HTMLElement;
    const esTexto =
      CAMPOS_DE_TEXTO.has(objetivo.tagName) && !(objetivo instanceof HTMLInputElement && objetivo.type === "checkbox");
    if (esTexto) return;
    const fila = objetivo.closest<HTMLLIElement>("[data-decision]");
    const indice = fila ? filas.current.indexOf(fila) : activa;

    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      enfocar(indice + (evento.key === "ArrowDown" ? 1 : -1));
      return;
    }
    const tecla = evento.key.toLowerCase();
    if (tecla !== "a" && tecla !== "r") return;
    const boton = filas.current[indice]?.querySelector<HTMLButtonElement>(
      `[data-atajo="${tecla === "a" ? "aprobar" : "rechazar"}"]:not(:disabled)`,
    );
    if (!boton) return;
    evento.preventDefault();
    boton.click();
    requestAnimationFrame(() => {
      const vivas = filas.current.filter((nodo): nodo is HTMLLIElement => Boolean(nodo?.isConnected));
      vivas[Math.min(indice, vivas.length - 1)]?.focus();
    });
  }

  function alternar(id: string) {
    setElegidas((antes) => {
      const despues = new Set(antes);
      if (despues.has(id)) despues.delete(id);
      else despues.add(id);
      return despues;
    });
  }

  return (
    <section className="bandeja" aria-labelledby="bandeja-titulo">
      <header className="bandeja-cabeza">
        <h2 id="bandeja-titulo">
          Necesita tu decisión
          <span
            className="bandeja-cuenta"
            aria-label={
              decisiones.length === 1 ? ", 1 pendiente" : `, ${decisiones.length} pendientes`
            }
          >
            {decisiones.length > 0 ? <span className="bandeja-punto" aria-hidden="true" /> : null}
            <span aria-hidden="true">{decisiones.length}</span>
          </span>
        </h2>
        {decisiones.length > 0 ? (
          <div className="bandeja-herramientas">
            <p className="atajos">
              Atajos: <kbd>A</kbd> aprobar <kbd>R</kbd> rechazar <kbd aria-label="flecha arriba">↑</kbd>
              <kbd aria-label="flecha abajo">↓</kbd> moverte
            </p>
            {conLote ? (
              <>
                <button
                  type="button"
                  className="boton-texto"
                  onClick={() =>
                    setElegidas(todas ? new Set() : new Set(decisiones.map((decision) => decision.id)))
                  }
                >
                  {todas ? "Quitar selección" : "Seleccionar todo"}
                </button>
                <button
                  type="button"
                  className="boton boton-apagado"
                  disabled={elegidas.size === 0}
                  onClick={() => aprobarSeleccionadas?.([...elegidas])}
                >
                  Aprobar seleccionadas
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </header>
      {decisiones.length === 0 ? (
        <div className="bandeja-vacia">{vacio}</div>
      ) : (
        <ul className="decisiones" onKeyDown={alTeclear}>
          {decisiones.map((decision, indice) => (
            <li
              key={decision.id}
              ref={(nodo) => {
                filas.current[indice] = nodo;
              }}
              className={conLote ? "decision decision-con-casilla" : "decision"}
              data-decision=""
              tabIndex={indice === activa ? 0 : -1}
              aria-label={decision.titulo}
              onFocus={() => setActiva(indice)}
            >
              {conLote ? (
                <input
                  type="checkbox"
                  className="decision-casilla"
                  checked={elegidas.has(decision.id)}
                  onChange={() => alternar(decision.id)}
                  aria-label={`Seleccionar ${decision.titulo}`}
                />
              ) : null}
              <span className="decision-icono" aria-hidden="true">
                {decision.icono}
              </span>
              <div className="decision-cuerpo">
                <p className="decision-titulo">{decision.titulo}</p>
                <div className="decision-detalle">{decision.detalle}</div>
                {decision.contexto?.length ? (
                  <p className="decision-contexto">
                    {decision.contexto.map((linea, posicion) => (
                      <span key={posicion}>{linea}</span>
                    ))}
                  </p>
                ) : null}
              </div>
              <div className="decision-acciones">{decision.acciones}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
