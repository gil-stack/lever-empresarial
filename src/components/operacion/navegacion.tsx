"use client";

import Link, { useLinkStatus } from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { rutaSeccionOperacion, SECCIONES_OPERACION } from "./secciones";

function ProgresoEnlace() {
  const { pending } = useLinkStatus();

  return (
    <span className="operacion-nav-estado" aria-live="polite">
      {pending ? <><span className="operacion-nav-spinner" aria-hidden="true" /><span className="operacion-nav-lectura">Cargando…</span></> : null}
    </span>
  );
}

export function NavegacionOperacion() {
  const actual = rutaSeccionOperacion(useSelectedLayoutSegment());

  return (
    <nav className="operacion-nav" aria-label="Operación">
      {SECCIONES_OPERACION.map(([ruta, etiqueta]) => (
        <Link key={ruta} href={ruta} prefetch={true} aria-current={actual === ruta ? "page" : undefined}>
          {etiqueta}<ProgresoEnlace />
        </Link>
      ))}
    </nav>
  );
}
