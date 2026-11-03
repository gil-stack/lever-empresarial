export type EstadoFormulario =
  | { tipo: "inicial" }
  | { tipo: "guardado"; mensaje: string }
  | { tipo: "invalido"; mensaje: string };

export const FORMULARIO_INICIAL: EstadoFormulario = { tipo: "inicial" };
