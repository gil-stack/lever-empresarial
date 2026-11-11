"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { IconoEmpresas, IconoInicio, IconoPendientes } from "@/components/cromo/iconos";
import { ProgresoEnlace } from "@/components/cromo/progreso-enlace";

import {
  IconoAlertas,
  IconoBitacora,
  IconoBloqueadas,
  IconoComisiones,
  IconoCumplimiento,
  IconoPersonal,
  IconoPrecios,
  IconoRecuperaciones,
} from "./iconos";
import { IconoAlertasPld, IconoAvisoPld, IconoComite, IconoConservacion, IconoReportes } from "./pld/iconos";
import { rutaSeccionOperacion, seccionesVisibles, type RutaOperacion } from "./secciones";

const ICONOS: Record<RutaOperacion, () => ReactNode> = {
  "/operacion": IconoInicio,
  "/operacion/clientes": IconoEmpresas,
  "/operacion/aprobaciones": IconoPendientes,
  "/operacion/cumplimiento": IconoCumplimiento,
  "/operacion/lpb": IconoBloqueadas,
  "/operacion/alertas": IconoAlertas,
  "/operacion/comisiones": IconoComisiones,
  "/operacion/recuperaciones": IconoRecuperaciones,
  "/operacion/precios": IconoPrecios,
  "/operacion/personal": IconoPersonal,
  "/operacion/bitacora": IconoBitacora,
  "/operacion/pld": IconoAlertasPld,
  "/operacion/avisos": IconoAvisoPld,
  "/operacion/comite": IconoComite,
  "/operacion/reportes": IconoReportes,
  "/operacion/conservacion": IconoConservacion,
};

/**
 * Las secciones de Operación con el lateral de la consola: ícono, barra coral en la actual y progreso por enlace (useLinkStatus).
 * Solo las que abren las capacidades de la persona; la página y el servidor lo vuelven a exigir.
 */
export function NavegacionOperacion({ capacidades }: { capacidades: readonly string[] }) {
  const actual = rutaSeccionOperacion(useSelectedLayoutSegment());

  return (
    <nav className="secciones" aria-label="Operación">
      <ul>
        {seccionesVisibles(capacidades).map(([ruta, etiqueta]) => {
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
