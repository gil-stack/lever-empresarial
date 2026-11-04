export type EstadoClabe =
  | { tipo: "inicial" }
  | { tipo: "guardado"; mensaje: string }
  | { tipo: "invalido"; mensaje: string };

export const FORMULARIO_CLABE_INICIAL: EstadoClabe = { tipo: "inicial" };
