"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { rutaSeccionOperacion, SECCIONES_OPERACION } from "./secciones";

export function NavegacionOperacion() {
  const actual = rutaSeccionOperacion(useSelectedLayoutSegment());

  return (
    <nav className="operacion-nav" aria-label="Operación">
      {SECCIONES_OPERACION.map(([ruta, etiqueta]) => (
        <Link key={ruta} href={ruta} aria-current={actual === ruta ? "page" : undefined}>{etiqueta}</Link>
      ))}
    </nav>
  );
}
