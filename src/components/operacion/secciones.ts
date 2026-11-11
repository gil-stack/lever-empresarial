import type { CapacidadPlataforma } from "../../nucleo/capacidades";

/**
 * Las secciones de Operación: ruta, etiqueta y las capacidades que la abren (basta una).
 * Cada rol de la Ola R1 ve solo lo que puede trabajar; la página y el servidor lo vuelven a exigir.
 */
export const SECCIONES_OPERACION = [
  ["/operacion", "Resumen", ["plataforma.operacion.ver"]],
  ["/operacion/clientes", "Clientes", ["plataforma.operacion.ver"]],
  ["/operacion/aprobaciones", "Aprobaciones", ["plataforma.activacion.aprobar", "plataforma.suspension.aprobar", "plataforma.empresa.alta"]],
  ["/operacion/cumplimiento", "Cumplimiento", ["plataforma.cumplimiento.bandeja"]],
  ["/operacion/lpb", "Personas bloqueadas", ["plataforma.cumplimiento.bandeja"]],
  ["/operacion/pld", "Alertas PLD", ["plataforma.pld.ver"]],
  ["/operacion/comite", "Comité", ["plataforma.pld.ver"]],
  ["/operacion/reportes", "Reportes regulatorios", ["plataforma.pld.ver"]],
  ["/operacion/conservacion", "Conservación", ["plataforma.pld.manifiesto"]],
  ["/operacion/alertas", "Alertas", ["plataforma.operacion.ver"]],
  ["/operacion/comisiones", "Comisiones", ["plataforma.operacion.ver"]],
  ["/operacion/recuperaciones", "Recuperaciones", ["plataforma.empresa.alta"]],
  ["/operacion/precios", "Precios", ["plataforma.operacion.ver"]],
  ["/operacion/personal", "Personal", ["plataforma.personal.administrar"]],
  ["/operacion/bitacora", "Bitácora", ["plataforma.bitacora.ver"]],
  ["/operacion/avisos", "Avisar a Cumplimiento", ["plataforma.pld.aviso.emitir"]],
] as const satisfies ReadonlyArray<readonly [string, string, readonly CapacidadPlataforma[]]>;

export type RutaOperacion = (typeof SECCIONES_OPERACION)[number][0];

export function rutaSeccionOperacion(segmento: string | null) {
  return segmento === null ? "/operacion" : `/operacion/${segmento}`;
}

/** Las secciones que abre este conjunto de capacidades, en el orden del menú. */
export function seccionesVisibles(capacidades: readonly string[]) {
  return SECCIONES_OPERACION.filter(([, , alguna]) => alguna.some((capacidad) => capacidades.includes(capacidad)));
}
