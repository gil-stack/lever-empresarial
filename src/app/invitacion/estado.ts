export type EstadoAceptar =
  | { tipo: "inicial" }
  | { tipo: "asentado"; titulo: string; mensaje: string }
  | { tipo: "invalido"; titulo: string; mensaje: string };

export const ACEPTAR_INICIAL: EstadoAceptar = { tipo: "inicial" };
