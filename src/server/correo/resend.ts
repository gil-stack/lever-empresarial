import type { ConfiguracionCorreo } from "./configuracion";
import { ErrorDeCorreo } from "./errores";
import type { Enviador, MensajeCorreo } from "./tipos";

const ENDPOINT = "https://api.resend.com/emails";
const ESPERA_MS = 10_000;
const LLAVE_IDEMPOTENCIA = /^[A-Za-z0-9/_-]{1,256}$/;
const ETIQUETA = /^[A-Za-z0-9_-]{1,256}$/;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Habla con la API de Resend por HTTP. La clave solo viaja en el encabezado
 * Authorization; la respuesta del proveedor no se copia al error.
 */
export function enviadorResend(config: ConfiguracionCorreo, hacerFetch: Fetch = fetch): Enviador {
  return async (mensaje: MensajeCorreo) => {
    if (!LLAVE_IDEMPOTENCIA.test(mensaje.idempotencia)) {
      throw new ErrorDeCorreo("correo_no_disponible");
    }
    const cuerpo: Record<string, unknown> = {
      from: config.remitente,
      to: [mensaje.para],
      subject: mensaje.asunto,
      html: mensaje.html,
      text: mensaje.texto,
    };
    if (mensaje.etiqueta && ETIQUETA.test(mensaje.etiqueta)) {
      cuerpo.tags = [{ name: "tipo", value: mensaje.etiqueta }];
    }

    let respuesta: Response;
    try {
      respuesta = await hacerFetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": mensaje.idempotencia,
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(ESPERA_MS),
        cache: "no-store",
      });
    } catch {
      throw new ErrorDeCorreo("correo_no_disponible");
    }

    if (!respuesta.ok) throw new ErrorDeCorreo(codigoPorEstado(respuesta.status));

    let datos: unknown;
    try {
      datos = await respuesta.json();
    } catch {
      throw new ErrorDeCorreo("correo_no_disponible");
    }
    const id = typeof datos === "object" && datos !== null ? (datos as { id?: unknown }).id : undefined;
    if (typeof id !== "string" || id.length === 0) throw new ErrorDeCorreo("correo_no_disponible");
    return { id };
  };
}

function codigoPorEstado(estado: number) {
  if (estado === 401 || estado === 403) return "correo_rechazado" as const;
  if (estado === 400 || estado === 422) return "correo_destinatario_invalido" as const;
  if (estado === 429) return "correo_limite" as const;
  return "correo_no_disponible" as const;
}
