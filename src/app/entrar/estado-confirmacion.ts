/**
 * Estado de la pantalla «Confirma que eres tú». Vive fuera del archivo de
 * acciones: un módulo "use server" solo exporta funciones.
 */
export type EstadoConfirmacion =
  | { tipo: "inicial" }
  | { tipo: "confirmada" }
  | { tipo: "error"; mensaje: string };

export const CONFIRMACION_INICIAL: EstadoConfirmacion = { tipo: "inicial" };
