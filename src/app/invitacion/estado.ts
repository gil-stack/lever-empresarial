/**
 * `deLaContrasena` dice si el rechazo es de lo que se escribió: solo entonces la pantalla marca
 * los campos de contraseña. Una invitación vencida o una empresa suspendida no son culpa del campo.
 */
export type EstadoInvitacion =
  | { tipo: "inicial" }
  | { tipo: "invalido"; titulo: string; mensaje: string; deLaContrasena: boolean };

export const INVITACION_INICIAL: EstadoInvitacion = { tipo: "inicial" };

const MENSAJES: Record<string, string> = {
  contrasena_invalida: "La contraseña necesita al menos 10 caracteres. Si es demasiado larga, elige otra.",
  contrasenas_distintas: "Las dos contraseñas no coinciden.",
  credenciales_invalidas: "Esa no es tu contraseña.",
  invitacion_usada: "Esta invitación ya se usó. Entra con tu correo.",
  invitacion_vencida: "Esta invitación venció. Pide otra a quien te invitó.",
  invitacion_revocada: "Esta invitación ya no sirve. Pide otra a quien te invitó.",
  invitacion_inexistente: "Este enlace no es una invitación.",
  invitacion_cerrada: "Esta invitación ya no sirve. Pide otra a quien te invitó.",
  empresa_suspendida: "Por ahora no admite cuentas nuevas. Comunícate con Lever.",
};

const TITULOS: Record<string, string> = {
  empresa_suspendida: "La empresa está suspendida",
};

const DE_LA_CONTRASENA = new Set(["contrasena_invalida", "contrasenas_distintas", "credenciales_invalidas"]);

/** El rechazo que ve la persona invitada para un código de dominio. */
export function rechazoDeInvitacion(codigo: string): EstadoInvitacion {
  return {
    tipo: "invalido",
    titulo: TITULOS[codigo] ?? "No se aceptó",
    mensaje: MENSAJES[codigo] ?? "No se pudo aceptar. Vuelve a intentar.",
    deLaContrasena: DE_LA_CONTRASENA.has(codigo),
  };
}
