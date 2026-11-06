"use client";

import { createContext, useContext, useEffect } from "react";
import { useLinkStatus } from "next/link";

/**
 * Quien necesita saber que una sección está cargando aunque su enlace no se vea: en pantallas
 * angostas el cajón se cierra al pulsar la sección y la barra móvil muestra el progreso.
 */
export const AvisarCarga = createContext<((cargando: boolean) => void) | null>(null);

export function ProgresoEnlace() {
  const { pending } = useLinkStatus();
  const avisar = useContext(AvisarCarga);

  useEffect(() => {
    if (!pending || !avisar) return;
    avisar(true);
    return () => avisar(false);
  }, [pending, avisar]);

  return (
    <span className="seccion-progreso" aria-live="polite">
      {pending ? <><span className="seccion-spinner" aria-hidden="true" /><span className="seccion-lectura">Cargando…</span></> : null}
    </span>
  );
}
