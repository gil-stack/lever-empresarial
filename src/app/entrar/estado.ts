/**
 * El estado que pinta la pantalla del segundo factor. Vive fuera del archivo
 * de acciones: un módulo "use server" solo puede exportar funciones, y esta
 * constante la lee el navegador.
 */
export type EstadoFactor =
  | { tipo: "inicial" }
  | { tipo: "error"; mensaje: string; codigo?: string }
  | { tipo: "codigos"; codigos: string[] }
  | { tipo: "alta"; alta: { qr: string; semilla: string } };

export const FACTOR_INICIAL: EstadoFactor = { tipo: "inicial" };
