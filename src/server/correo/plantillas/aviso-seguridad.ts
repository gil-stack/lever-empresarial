import type { CorreoPlantilla } from "../tipos";
import { armarCorreo, fechaEnMexico } from "./marco";

export type CambioDeSeguridad =
  | "passkey_agregada"
  | "passkey_quitada"
  | "totp_activado"
  | "totp_quitado"
  | "respaldo_regenerado"
  | "recuperacion_aprobada"
  | "factor_reinscrito"
  | "contrasena_cambiada";

const TEXTOS: Record<CambioDeSeguridad, { asunto: string; que: string }> = {
  passkey_agregada: { asunto: "Agregaste una passkey", que: "Se agregó una passkey nueva a tu cuenta." },
  passkey_quitada: { asunto: "Quitaste una passkey", que: "Se quitó una passkey de tu cuenta." },
  totp_activado: { asunto: "Activaste la app autenticadora", que: "Se activó una app autenticadora en tu cuenta." },
  totp_quitado: { asunto: "Quitaste la app autenticadora", que: "Se quitó la app autenticadora de tu cuenta." },
  respaldo_regenerado: {
    asunto: "Generaste códigos de respaldo nuevos",
    que: "Se generaron códigos de respaldo nuevos. Los anteriores ya no sirven.",
  },
  recuperacion_aprobada: {
    asunto: "Aprobamos registrar un segundo factor nuevo",
    que: "El personal de Lever aprobó que registres un segundo factor nuevo en tu próxima entrada.",
  },
  factor_reinscrito: {
    asunto: "Registraste un segundo factor nuevo",
    que: "Se registró un segundo factor nuevo después de una recuperación aprobada.",
  },
  contrasena_cambiada: {
    asunto: "Cambiaste tu contraseña",
    que: "La contraseña de tu cuenta cambió con el enlace de recuperación. Las sesiones abiertas se cerraron; tu segundo factor no cambió.",
  },
};

/** Aviso a la persona cada vez que cambia cómo se entra a su cuenta. */
export function plantillaAvisoSeguridad(datos: {
  nombre: string;
  cambio: CambioDeSeguridad;
  cuando: Date;
  enlace: string;
}): CorreoPlantilla {
  const texto = TEXTOS[datos.cambio];
  return armarCorreo(texto.asunto, {
    preencabezado: texto.que,
    kicker: "Aviso de seguridad",
    titulo: `Hola, ${datos.nombre}. ${texto.asunto}.`,
    parrafos: [
      texto.que,
      "Si fuiste tú, no tienes que hacer nada.",
      "Si no fuiste tú, cambia tu contraseña desde «Olvidé mi contraseña» y avisa hoy mismo a quien administra tu empresa.",
    ],
    datos: [["Fecha del cambio", fechaEnMexico(datos.cuando)]],
    boton: { texto: "Entrar a Lever", url: datos.enlace },
    notas: ["Este correo no pide datos ni contraseñas. Nadie de Lever te los va a pedir."],
  });
}
