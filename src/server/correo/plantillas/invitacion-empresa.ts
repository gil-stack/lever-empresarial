import type { CorreoPlantilla } from "../tipos";
import { armarCorreo, fechaEnMexico } from "./marco";

export type DatosInvitacionEmpresa = {
  nombre: string;
  razonSocial: string;
  rfc: string;
  enlace: string;
  venceEn: Date;
};

export function plantillaInvitacionEmpresa(datos: DatosInvitacionEmpresa): CorreoPlantilla {
  return armarCorreo(`Bienvenido a ${datos.razonSocial} | LEVER`, {
    preencabezado: `Tu plataforma para administrar ${datos.razonSocial} está lista.`,
    kicker: "Bienvenido a LEVER",
    titulo: `Bienvenido a tu nueva plataforma, ${datos.nombre}.`,
    parrafos: [
      `La cuenta de ${datos.razonSocial} está lista. Como administrador, puedes invitar a tu equipo, configurar las reglas de gasto y revisar cada decisión.`,
      "Para comenzar, define tu contraseña y registra tu segundo factor: una passkey o una app autenticadora. Los dos pasos protegen tu acceso.",
      "Desde tu primer ingreso, cada comprobante y cada aprobación queda en el expediente correcto.",
    ],
    datos: [
      ["Razón social", datos.razonSocial],
      ["RFC", datos.rfc],
      ["Rol", "Administrador"],
    ],
    boton: { texto: "Crear mi acceso", url: datos.enlace },
    notas: [
      `El enlace sirve una sola vez y vence el ${fechaEnMexico(datos.venceEn)}.`,
      "Si no esperabas este correo, ignóralo. Sin abrir el enlace no se activa ningún acceso.",
    ],
  });
}
