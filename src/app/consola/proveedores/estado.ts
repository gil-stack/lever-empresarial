export type EstadoClabe =
  | { tipo: "inicial" }
  | { tipo: "guardado"; mensaje: string }
  | { tipo: "guardado_sin_aviso"; mensaje: string }
  | { tipo: "invalido"; mensaje: string };

export const FORMULARIO_CLABE_INICIAL: EstadoClabe = { tipo: "inicial" };

export type EstadoPagoFormulario =
  | { tipo: "inicial" }
  | {
      tipo: "invalido";
      mensaje: string;
      /** El campo que causó el error, para ligarlo con aria-describedby. */
      campo?: string;
      /** El código del error de dominio: la bandeja pide el código de la app si el segundo factor ya no es reciente. */
      codigo?: string;
    }
  | { tipo: "listo"; mensaje: string; requestId?: string };

export const ESTADO_PAGO_INICIAL: EstadoPagoFormulario = { tipo: "inicial" };
