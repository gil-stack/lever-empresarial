import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { enviadorDesdeEntorno } from "../correo/enviar";
import { plantillaAvisoSeguridad, type CambioDeSeguridad } from "../correo/plantillas/aviso-seguridad";
import { urlPublica } from "../invitaciones/correo";

export type { CambioDeSeguridad } from "../correo/plantillas/aviso-seguridad";

export type AvisoDeSeguridad = {
  userId: string;
  para: string;
  nombre: string;
  cambio: CambioDeSeguridad;
  cuando: Date;
};

export type Avisar = (aviso: AvisoDeSeguridad) => Promise<void>;

/** Manda el aviso con Resend. Lanza si el correo no está configurado o no sale. */
export const avisarPorCorreo: Avisar = async (aviso) => {
  const plantilla = plantillaAvisoSeguridad({
    nombre: aviso.nombre,
    cambio: aviso.cambio,
    cuando: aviso.cuando,
    enlace: `${urlPublica()}/entrar`,
  });
  await enviadorDesdeEntorno()({
    para: aviso.para,
    asunto: plantilla.asunto,
    html: plantilla.html,
    texto: plantilla.texto,
    idempotencia: `seguridad/${aviso.cambio}/${aviso.userId}/${aviso.cuando.getTime()}`,
    etiqueta: "aviso_seguridad",
  });
};

/**
 * El cambio ya quedó asentado y auditado cuando se llama: un correo que no sale
 * no lo deshace ni lo esconde. Se registra con identificadores internos y el
 * código del error, nunca con el correo ni el nombre.
 */
export async function avisarSinDeshacer(avisar: Avisar, aviso: AvisoDeSeguridad): Promise<boolean> {
  try {
    await avisar(aviso);
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        nivel: "error",
        origen: "autenticacion.avisos",
        evento: "aviso_seguridad_no_enviado",
        cambio: aviso.cambio,
        usuario: aviso.userId,
        error: codigoDe(error),
      }),
    );
    return false;
  }
}

function codigoDe(error: unknown): string {
  if (error instanceof ErrorDeDominio) return error.codigo;
  return error instanceof Error && /^[A-Za-z]{1,60}$/.test(error.name) ? error.name : "desconocido";
}
