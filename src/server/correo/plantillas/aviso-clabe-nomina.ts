import type { CorreoPlantilla } from "../tipos";
import { armarCorreo, fechaEnMexico } from "./marco";

export type DatosAvisoClabeNomina = {
  nombre: string;
  razonSocial: string;
  /** Solo los últimos cuatro dígitos. El correo nunca lleva la CLABE completa. */
  finalNueva: string;
  cambiadaEn: Date;
  enlace: string;
};

/** Aviso a la persona cuando alguien cambia la cuenta donde recibe su nómina. */
export function plantillaAvisoClabeNomina(datos: DatosAvisoClabeNomina): CorreoPlantilla {
  return armarCorreo("Cambió la cuenta de tu nómina", {
    preencabezado: `La CLABE donde recibes tu nómina en ${datos.razonSocial} cambió.`,
    kicker: "Aviso de seguridad",
    titulo: `Hola, ${datos.nombre}. Cambió la cuenta de tu nómina.`,
    parrafos: [
      `Una persona administradora de ${datos.razonSocial} registró una CLABE nueva para tus depósitos de nómina.`,
      "Si tú lo pediste, no tienes que hacer nada.",
      "Si no lo pediste, avisa hoy mismo a tu empresa: el siguiente pago iría a la cuenta nueva.",
    ],
    datos: [
      ["Cuenta nueva", `CLABE terminación ${datos.finalNueva}`],
      ["Fecha del cambio", fechaEnMexico(datos.cambiadaEn)],
    ],
    boton: { texto: "Entrar a Lever", url: datos.enlace },
    notas: ["Este correo no pide datos ni contraseñas. Nadie de Lever te los va a pedir."],
  });
}
