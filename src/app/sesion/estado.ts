/** `correo` regresa lo que se escribió: React reinicia el formulario al terminar y el campo quedaría vacío. */
export type EstadoEntrada = { tipo: "inicial" } | { tipo: "invalido"; mensaje: string; correo?: string };

export const ENTRADA_INICIAL: EstadoEntrada = { tipo: "inicial" };
