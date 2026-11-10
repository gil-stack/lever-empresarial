import type { RolPlataforma } from "../../../nucleo/capacidades";
import type { CorreoPlantilla } from "../tipos";
import { armarCorreo, fechaEnMexico } from "./marco";

export type DatosInvitacionPersonal = {
  nombre: string;
  roles: readonly RolPlataforma[];
  enlace: string;
  venceEn: Date;
};

const ETIQUETAS: Readonly<Record<RolPlataforma, string>> = {
  administracion_plataforma: "Administración de plataforma",
  originacion: "Originación",
  aprobacion: "Aprobación",
  cumplimiento: "Cumplimiento",
  auditoria: "Auditoría",
};

export function plantillaInvitacionPersonal(datos: DatosInvitacionPersonal): CorreoPlantilla {
  const roles = datos.roles.map((rol) => ETIQUETAS[rol]).join(", ");
  return armarCorreo("Bienvenido al equipo LEVER", {
    preencabezado: "Tu acceso al equipo de operación de LEVER está listo.",
    kicker: "Bienvenido al equipo",
    titulo: `Bienvenido al equipo LEVER, ${datos.nombre}.`,
    parrafos: [
      "Un administrador de LEVER te dio acceso a Operación: clientes, aprobaciones, alertas, comisiones y bitácora.",
      "Para comenzar, define tu contraseña y registra tu segundo factor: una passkey o una app autenticadora. Los dos pasos protegen tu acceso.",
      "Si ya tenías una cuenta con este correo, confirma con tu contraseña y tu segundo factor actuales.",
    ],
    datos: [
      ["Equipo", "LEVER"],
      [datos.roles.length > 1 ? "Roles" : "Rol", roles],
    ],
    boton: { texto: "Crear mi acceso", url: datos.enlace },
    notas: [
      `El enlace sirve una sola vez y vence el ${fechaEnMexico(datos.venceEn)}.`,
      "Si no esperabas esta invitación, ignora este correo. Sin abrir el enlace no se activa ningún acceso.",
    ],
  });
}
