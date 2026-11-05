export type EstadoClabe =
  | { tipo: "inicial" }
  | { tipo: "guardado"; mensaje: string }
  | { tipo: "invalido"; mensaje: string };

export const FORMULARIO_CLABE_INICIAL: EstadoClabe = { tipo: "inicial" };

export type EstadoPagoFormulario =
  | { tipo: "inicial" }
  | { tipo: "invalido"; mensaje: string }
  | { tipo: "listo"; mensaje: string; requestId?: string };

export const ESTADO_PAGO_INICIAL: EstadoPagoFormulario = { tipo: "inicial" };
