import type { CorreoPlantilla } from "../tipos";
import { armarCorreo, fechaEnMexico } from "./marco";

export type DatosInvitacionEmpresa = {
  nombre: string;
  razonSocial: string;
  rfc: string;
  enlace: string;
  venceEn: Date;
};

/** La primera persona de una empresa nueva: entra como administradora. */
export function plantillaInvitacionEmpresa(datos: DatosInvitacionEmpresa): CorreoPlantilla {
  return armarCorreo(`Tu acceso a ${datos.razonSocial}`, {
    preencabezado: `Elige tu contraseña para administrar la cuenta de ${datos.razonSocial}.`,
    kicker: "Invitación",
    titulo: `Hola, ${datos.nombre}. La cuenta de ${datos.razonSocial} está lista.`,
    parrafos: [
      "Te dieron el rol de administración de la empresa: desde ahí invitas a tu equipo y configuras la política de gasto.",
      "Para entrar, elige tu contraseña. Nadie más la conoce: ni la plataforma ni quien te invitó.",
      "Después registras tu segundo factor: una passkey o, si tu equipo no la admite, una app de códigos. Sin él no se entra.",
    ],
    datos: [
      ["Razón social", datos.razonSocial],
      ["RFC", datos.rfc],
      ["Rol", "Administrador"],
    ],
    boton: { texto: "Elegir mi contraseña", url: datos.enlace },
    notas: [
      `El enlace sirve una sola vez y vence el ${fechaEnMexico(datos.venceEn)}.`,
      "Si no esperabas este correo, ignóralo. Sin abrir el enlace no se crea ningún acceso.",
    ],
  });
}
