import type { RolCliente } from "../../../nucleo/capacidades";
import type { CorreoPlantilla } from "../tipos";
import { armarCorreo, fechaEnMexico } from "./marco";

export type DatosInvitacionUsuario = {
  nombre: string;
  razonSocial: string;
  quienInvita: string | null;
  roles: readonly RolCliente[];
  enlace: string;
  venceEn: Date;
};

const ETIQUETAS: Readonly<Record<RolCliente, string>> = {
  administrador: "Administrador",
  solicitante: "Solicitante",
  liberador: "Liberador",
  tarjetahabiente: "Tarjetahabiente",
  contador: "Contador",
};

/** Una persona que se suma a una empresa que ya opera. */
export function plantillaInvitacionUsuario(datos: DatosInvitacionUsuario): CorreoPlantilla {
  const quien = datos.quienInvita ?? "La administración de la empresa";
  const roles = datos.roles.map((rol) => ETIQUETAS[rol]).join(", ");
  return armarCorreo(`${quien} te invitó a ${datos.razonSocial}`, {
    preencabezado: `Acepta la invitación y elige tu contraseña para entrar a ${datos.razonSocial}.`,
    kicker: "Invitación",
    titulo: `Hola, ${datos.nombre}. ${quien} te invitó a ${datos.razonSocial}.`,
    parrafos: [
      "Al aceptar, eliges tu propia contraseña. Nadie más la conoce: ni la plataforma ni quien te invitó.",
      "Después registras tu segundo factor: una passkey o, si tu equipo no la admite, una app de códigos. Sin él no se entra.",
      "Si ya tienes cuenta con este correo, aceptas con tu contraseña y tu segundo factor de siempre.",
    ],
    datos: [
      ["Empresa", datos.razonSocial],
      [datos.roles.length > 1 ? "Roles" : "Rol", roles],
    ],
    boton: { texto: "Aceptar la invitación", url: datos.enlace },
    notas: [
      `El enlace sirve una sola vez y vence el ${fechaEnMexico(datos.venceEn)}.`,
      "Si no conoces a quien te invitó, ignora este correo. Sin abrir el enlace no se crea ningún acceso.",
    ],
  });
}
