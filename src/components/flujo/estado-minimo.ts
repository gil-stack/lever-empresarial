import type { EstadoFlujo } from "@/dominio/flujo/entradas";

/** El estado del formulario del mínimo de meses: el de siempre más lo que la persona escribió. */
export type EstadoMinimo = EstadoFlujo & { escrito?: string };

export const ESTADO_MINIMO_INICIAL: EstadoMinimo = { tipo: "inicial" };
