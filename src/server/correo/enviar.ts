import { leerConfiguracionCorreo, type Entorno } from "./configuracion";
import { enviadorResend, type Fetch } from "./resend";
import type { Enviador } from "./tipos";

/**
 * Arma el enviador con lo que hay en el entorno. Si falta la clave o el
 * remitente, lanza `correo_no_configurado` antes de tocar la red: quien
 * llama puede hacerlo antes de escribir la base y no deja nada a medias.
 */
export function enviadorDesdeEntorno(entorno?: Entorno, hacerFetch?: Fetch): Enviador {
  return enviadorResend(leerConfiguracionCorreo(entorno), hacerFetch);
}
