import { accionesPendientes, type PendienteInicio } from "@/dominio/inicio";
import type { PagoVista } from "@/dominio/pagos-vistas";

/** Lo que se pudo leer de cada fuente; `null` cuando el rol no la ve o la lectura falló. */
export type FuentesAprobaciones = {
  pendientes: readonly PendienteInicio[];
  personaId: string;
  /** Pagos «por autorizar» de la empresa (la primera página de Proveedores). */
  pagos: { pagos: readonly PagoVista[]; hayMas: boolean } | null;
  /** La fecha que prepara el botón de nómina: la más antigua vencida y sin lote. */
  fechaNomina: string | null;
};

export type Aprobaciones = {
  /** Cada pago que esta persona puede decidir, con el pendiente que los cuenta. */
  pagos: { pendiente: PendienteInicio; pagos: PagoVista[]; hayMas: boolean } | null;
  nomina: { pendiente: PendienteInicio; fecha: string } | null;
  /** Alertas de presupuesto: no se aprueban, se revisan. */
  avisos: PendienteInicio[];
  /** El resto de la bandeja (accesos, puesta en marcha) y lo que no se pudo desplegar aquí. */
  otros: PendienteInicio[];
  /** Las mismas acciones que cuenta el lateral (cada pago por autorizar es una): ni una más, ni una menos. */
  total: number;
};

/**
 * Reparte la bandeja de Pendientes entre las tarjetas de Aprobaciones. Cada
 * pendiente cae exactamente en un lugar; si su detalle no se pudo leer (sin
 * permiso o lectura caída), se queda como enlace en «otros» y no se pierde.
 * Los pagos que pidió la misma persona no se le ofrecen: los decide otra.
 */
export function armarAprobaciones(fuentes: FuentesAprobaciones): Aprobaciones {
  const avisos: PendienteInicio[] = [];
  const otros: PendienteInicio[] = [];
  let pagos: Aprobaciones["pagos"] = null;
  let nomina: Aprobaciones["nomina"] = null;
  for (const pendiente of fuentes.pendientes) {
    if (pendiente.id === "pagos-por-autorizar" && fuentes.pagos) {
      const decidibles = fuentes.pagos.pagos.filter(
        (pago) => pago.estado === "por_autorizar" && pago.solicitadoPor !== fuentes.personaId,
      );
      if (decidibles.length > 0 || fuentes.pagos.hayMas) {
        pagos = { pendiente, pagos: decidibles, hayMas: fuentes.pagos.hayMas };
        continue;
      }
    }
    if (pendiente.id === "nomina-por-preparar" && fuentes.fechaNomina) {
      nomina = { pendiente, fecha: fuentes.fechaNomina };
      continue;
    }
    if (pendiente.id.startsWith("presupuesto-")) {
      avisos.push(pendiente);
      continue;
    }
    otros.push(pendiente);
  }
  return { pagos, nomina, avisos, otros, total: accionesPendientes(fuentes.pendientes) };
}
