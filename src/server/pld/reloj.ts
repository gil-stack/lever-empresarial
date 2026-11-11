declare global {
  /**
   * Solo lo define el preload del recorrido de evidencia (tests/pld/reloj-preload.mjs),
   * que se niega a cargar fuera de una prueba local. En producción no existe.
   */
  var __relojPldE2E: (() => Date) | undefined;
}

/**
 * El «hoy» con que se leen los plazos de PLD: días restantes, «fuera de plazo»,
 * reportes por vencer, evaluaciones y «Falta el calendario». Las escrituras usan
 * la hora de la base (now()), nunca este reloj.
 */
export function ahoraPld(): Date {
  const fijo = globalThis.__relojPldE2E;
  return fijo ? fijo() : new Date();
}
