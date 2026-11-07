import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

export type CodigoCorreo =
  | "correo_no_configurado"
  | "correo_rechazado"
  | "correo_destinatario_invalido"
  | "correo_limite"
  | "correo_ya_enviado"
  | "correo_en_curso"
  | "correo_no_disponible";

/**
 * `faltan` lista nombres de variables de entorno, no sus valores.
 */
export class ErrorDeCorreo extends ErrorDeDominio {
  readonly faltan: readonly string[];

  constructor(codigo: CodigoCorreo, faltan: readonly string[] = []) {
    super(codigo);
    this.name = "ErrorDeCorreo";
    this.faltan = Object.freeze([...faltan]);
  }
}

/** Para quien administra: puede nombrar las variables que faltan. */
export function explicarErrorDeCorreo(error: ErrorDeCorreo): string {
  switch (error.codigo) {
    case "correo_no_configurado":
      return `El correo transaccional no está configurado. Falta ${unir(error.faltan)} en el entorno. No se envió nada.`;
    case "correo_rechazado":
      return "El proveedor de correo rechazó la credencial o el remitente. Revisa la clave y que el dominio del remitente esté verificado. No se envió nada.";
    case "correo_destinatario_invalido":
      return "El proveedor de correo no aceptó el destinatario. Revisa la dirección.";
    case "correo_limite":
      return "El proveedor de correo pidió esperar. Intenta de nuevo en unos minutos.";
    case "correo_ya_enviado":
      return "Ese correo ya se había enviado antes; el proveedor no lo mandó otra vez.";
    case "correo_en_curso":
      return "Ese correo se está enviando en otra petición. Intenta de nuevo en unos minutos.";
    default:
      return "El proveedor de correo no respondió. Intenta de nuevo en unos minutos.";
  }
}

function unir(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? "la configuración";
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}
