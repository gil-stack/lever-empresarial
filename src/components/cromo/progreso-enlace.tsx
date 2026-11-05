"use client";

import { useLinkStatus } from "next/link";

export function ProgresoEnlace() {
  const { pending } = useLinkStatus();

  return (
    <span className="seccion-progreso" aria-live="polite">
      {pending ? <><span className="seccion-spinner" aria-hidden="true" /><span className="seccion-lectura">Cargando…</span></> : null}
    </span>
  );
}
