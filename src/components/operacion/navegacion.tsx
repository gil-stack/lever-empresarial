"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { IconoEmpresas, IconoInicio, IconoPendientes } from "@/components/cromo/iconos";
import { ProgresoEnlace } from "@/components/cromo/progreso-enlace";

import { IconoAlertas, IconoBitacora, IconoComisiones, IconoPrecios, IconoRecuperaciones } from "./iconos";
import { rutaSeccionOperacion, SECCIONES_OPERACION } from "./secciones";

const ICONOS: Record<(typeof SECCIONES_OPERACION)[number][0], () => ReactNode> = {
  "/operacion": IconoInicio,
  "/operacion/clientes": IconoEmpresas,
  "/operacion/aprobaciones": IconoPendientes,
  "/operacion/alertas": IconoAlertas,
  "/operacion/comisiones": IconoComisiones,
  "/operacion/recuperaciones": IconoRecuperaciones,
  "/operacion/precios": IconoPrecios,
  "/operacion/bitacora": IconoBitacora,
};

/** Las secciones de Operación con el lateral de la consola: ícono, barra coral en la actual y progreso por enlace (useLinkStatus). */
export function NavegacionOperacion() {
  const actual = rutaSeccionOperacion(useSelectedLayoutSegment());

  return (
    <nav className="secciones" aria-label="Operación">
      <ul>
        {SECCIONES_OPERACION.map(([ruta, etiqueta]) => {
          const Icono = ICONOS[ruta];
          return (
            <li key={ruta}>
              <Link href={ruta} className="seccion" prefetch={true} aria-current={actual === ruta ? "page" : undefined}>
                <Icono />
                {etiqueta}
                <ProgresoEnlace />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
