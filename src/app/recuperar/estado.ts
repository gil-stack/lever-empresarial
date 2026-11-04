export type EstadoRecuperar =
  | { tipo: "inicial" }
  | { tipo: "asentado"; titulo: string; mensaje: string }
  | { tipo: "invalido"; titulo: string; mensaje: string };

export const RECUPERAR_INICIAL: EstadoRecuperar = { tipo: "inicial" };
