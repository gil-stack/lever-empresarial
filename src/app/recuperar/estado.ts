export type EstadoRecuperar =
  | { tipo: "inicial" }
  | { tipo: "invalido"; titulo: string; mensaje: string }
  | { tipo: "asentado"; titulo: string; mensaje: string };

export const RECUPERAR_INICIAL: EstadoRecuperar = { tipo: "inicial" };
