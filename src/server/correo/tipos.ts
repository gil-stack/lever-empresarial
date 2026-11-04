export type MensajeCorreo = {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /** `<tipo>/<id>`. Un reintento con la misma llave no manda un segundo correo. */
  idempotencia: string;
  etiqueta?: string;
};

export type Enviador = (mensaje: MensajeCorreo) => Promise<{ id: string }>;

export type CorreoPlantilla = {
  asunto: string;
  html: string;
  texto: string;
};
