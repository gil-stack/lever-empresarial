export const SECCIONES_OPERACION = [
  ["/operacion", "Resumen"],
  ["/operacion/clientes", "Clientes"],
  ["/operacion/aprobaciones", "Aprobaciones"],
  ["/operacion/alertas", "Alertas"],
  ["/operacion/comisiones", "Comisiones"],
  ["/operacion/recuperaciones", "Recuperaciones"],
  ["/operacion/precios", "Precios"],
  ["/operacion/bitacora", "Bitácora"],
] as const;

export function rutaSeccionOperacion(segmento: string | null) {
  return segmento === null ? "/operacion" : `/operacion/${segmento}`;
}
