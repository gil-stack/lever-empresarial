export type EstadoFormulario = { tipo: "inicial" } | { tipo: "invalido"; mensaje: string };

export const FORMULARIO_INICIAL: EstadoFormulario = { tipo: "inicial" };
