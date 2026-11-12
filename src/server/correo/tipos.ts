export type MensajeCorreo = {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /** `<tipo>/<id>`. Un reintento con la misma llave no manda un segundo correo. */
  idempotencia: string;
  etiqueta?: string;
  /** «Responder a»: el contacto de la empresa en un correo de cobro. Solo una dirección simple, sin nombre. */
  responderA?: string;
};

export type Enviador = (mensaje: MensajeCorreo) => Promise<{ id: string }>;

export type CorreoPlantilla = {
  asunto: string;
  html: string;
  texto: string;
};
