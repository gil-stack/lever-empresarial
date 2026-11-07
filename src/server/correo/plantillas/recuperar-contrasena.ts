import type { CorreoPlantilla } from "../tipos";
import { armarCorreo, fechaEnMexico } from "./marco";

export type DatosRecuperarContrasena = {
  nombre: string;
  enlace: string;
  venceEn: Date;
};

export function plantillaRecuperarContrasena(datos: DatosRecuperarContrasena): CorreoPlantilla {
  return armarCorreo("Cambia tu contraseña", {
    preencabezado: "Usa este enlace para elegir una contraseña nueva. Sirve una sola vez.",
    kicker: "Recuperar acceso",
    titulo: `Hola, ${datos.nombre}. Elige una contraseña nueva.`,
    parrafos: [
      "Alguien pidió cambiar la contraseña de tu cuenta. Si fuiste tú, usa el botón.",
      "Al guardarla se cierran las sesiones que tengas abiertas, en cualquier equipo.",
      "Tu segundo factor no cambia: al entrar con la contraseña nueva te lo vamos a pedir.",
    ],
    boton: { texto: "Elegir contraseña nueva", url: datos.enlace },
    notas: [
      `El enlace sirve una sola vez y vence el ${fechaEnMexico(datos.venceEn)}.`,
      "Si no lo pediste, ignora este correo: tu contraseña sigue igual.",
    ],
  });
}
