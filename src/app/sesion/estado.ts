export type EstadoEntrada = { tipo: "inicial" } | { tipo: "invalido"; mensaje: string };

export const ENTRADA_INICIAL: EstadoEntrada = { tipo: "inicial" };
