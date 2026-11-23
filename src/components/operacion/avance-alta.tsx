import type { ReactNode } from "react";

import { PASOS_ALTA, type AvanceAlta, type ClavePasoAlta, type EstadoPasoAlta } from "@/dominio/operacion";

const ETIQUETA: Record<EstadoPasoAlta, string> = {
  hecho: "Listo",
  en_curso: "En curso",
  atencion: "Requiere atención",
  pendiente: "Pendiente",
};

const MARCA: Record<EstadoPasoAlta, string> = { hecho: "✓", en_curso: "•", atencion: "!", pendiente: "" };

/**
 * El alta paso a paso en la ficha del cliente: cada paso con su estado, quién lo hace y, si la persona puede hacerlo
 * ahora, su acción (la pasa la página: un enlace o un botón de los que ya existen).
 */
export function AvanceDelAlta({ avance, acciones = {} }: { avance: AvanceAlta; acciones?: Partial<Record<ClavePasoAlta, ReactNode>> }) {
  return (
    <ol className="alta-pasos">
      {avance.pasos.map((paso, indice) => {
        const actual = avance.siguiente?.clave === paso.clave;
        return (
          <li key={paso.clave} className={`alta-paso alta-paso-${paso.estado}${actual ? " alta-paso-actual" : ""}`} aria-current={actual ? "step" : undefined}>
            <span className="alta-paso-marca" aria-hidden="true">
              {MARCA[paso.estado] || indice + 1}
            </span>
            <div className="alta-paso-cuerpo">
              <p className="alta-paso-titulo">
                <span>{paso.titulo}</span>
                <span className="alta-paso-estado">{ETIQUETA[paso.estado]}</span>
              </p>
              <p className="alta-paso-detalle">{paso.detalle}</p>
              <p className="alta-paso-rol">{paso.rol}</p>
              {acciones[paso.clave] ? <div className="alta-paso-accion">{acciones[paso.clave]}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** En la tabla de clientes: la barra de avance y el paso que sigue. */
export function AvanceCorto({ avance }: { avance: AvanceAlta }) {
  const porcentaje = Math.round((avance.hechos / avance.total) * 100);
  return (
    <div className="alta-corto">
      <div
        className="alta-corto-barra"
        role="meter"
        aria-label="Avance del alta"
        aria-valuemin={0}
        aria-valuemax={avance.total}
        aria-valuenow={avance.hechos}
        aria-valuetext={`${avance.hechos} de ${avance.total} pasos`}
      >
        <i style={{ width: `${porcentaje}%` }} />
      </div>
      <p className="alta-corto-texto">
        {avance.siguiente ? (
          <>
            <span className={avance.siguiente.estado === "atencion" ? "alta-corto-atencion" : undefined}>{avance.siguiente.titulo}</span>
            <span className="pista"> · {avance.hechos} de {avance.total}</span>
          </>
        ) : (
          "Alta completa"
        )}
      </p>
    </div>
  );
}

/** En la página de alta: los pasos del recorrido completo, antes de empezar. */
export function RecorridoDelAlta() {
  return (
    <ol className="alta-pasos alta-pasos-guia">
      {PASOS_ALTA.map((paso, indice) => (
        <li key={paso.clave} className={`alta-paso ${indice === 0 ? "alta-paso-en_curso alta-paso-actual" : "alta-paso-pendiente"}`} aria-current={indice === 0 ? "step" : undefined}>
          <span className="alta-paso-marca" aria-hidden="true">
            {indice + 1}
          </span>
          <div className="alta-paso-cuerpo">
            <p className="alta-paso-titulo">
              <span>{paso.titulo}</span>
            </p>
            <p className="alta-paso-detalle">{paso.explica}</p>
            <p className="alta-paso-rol">{paso.rol}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
