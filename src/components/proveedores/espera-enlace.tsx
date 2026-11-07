"use client";

import { useLinkStatus } from "next/link";

/**
 * Señal de espera dentro de un enlace de la mesa (vista, fila, paginación):
 * el mismo giro que el lateral mientras llega la vista pedida. Va como
 * descendiente del `<Link>` (`useLinkStatus`).
 */
export function EsperaEnlace() {
  const { pending } = useLinkStatus();
  return (
    <span className="espera-enlace" aria-live="polite">
      {pending ? <><span className="seccion-spinner" aria-hidden="true" /><span className="solo-lector">Cargando…</span></> : null}
    </span>
  );
}
