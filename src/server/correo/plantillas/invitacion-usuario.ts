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

export function plantillaInvitacionUsuario(datos: DatosInvitacionUsuario): CorreoPlantilla {
  const quien = datos.quienInvita ?? "La administración de la empresa";
  const roles = datos.roles.map((rol) => ETIQUETAS[rol]).join(", ");
  return armarCorreo(`Bienvenido a ${datos.razonSocial} | LEVER`, {
    preencabezado: `Tu acceso a ${datos.razonSocial} en LEVER está listo.`,
    kicker: "Bienvenido a LEVER",
    titulo: `Bienvenido a tu nueva plataforma, ${datos.nombre}.`,
    parrafos: [
      `${quien} te dio acceso a ${datos.razonSocial}. Desde aquí puedes trabajar con tu equipo, tus comprobantes y tus reglas de gasto en un mismo lugar.`,
      "Para comenzar, define tu contraseña y registra tu segundo factor: una passkey o una app autenticadora. Los dos pasos protegen tu acceso.",
      "Si ya tenías una cuenta con este correo, confirma con tu contraseña y tu segundo factor actuales.",
    ],
    datos: [
      ["Empresa", datos.razonSocial],
      [datos.roles.length > 1 ? "Roles" : "Rol", roles],
    ],
    boton: { texto: "Crear mi acceso", url: datos.enlace },
    notas: [
      `El enlace sirve una sola vez y vence el ${fechaEnMexico(datos.venceEn)}.`,
      "Si no esperabas esta invitación, ignora este correo. Sin abrir el enlace no se activa ningún acceso.",
    ],
  });
}
