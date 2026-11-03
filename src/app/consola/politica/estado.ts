export type EstadoFormulario =
  | { tipo: "inicial" }
  | { tipo: "guardado"; mensaje: string }
  | { tipo: "invalido"; mensaje: string; campo?: "dias" | "vencidos" };

export const FORMULARIO_INICIAL: EstadoFormulario = { tipo: "inicial" };
