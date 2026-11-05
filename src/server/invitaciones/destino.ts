import { RUTA_SEGUNDO_FACTOR } from "../../nucleo/rutas";
import { NOMBRE_COOKIE_ENTRADA } from "../autenticacion/cookie";
import { NOMBRE_COOKIE_ENTRADA_OPERACION } from "../operacion/acceso";

export function resolverDestinoInvitacion(companyId: string | null) {
  if (companyId === null) {
    return {
      superficie: "sofipo" as const,
      cookieEntrada: NOMBRE_COOKIE_ENTRADA_OPERACION,
      ruta: "/operacion/continuar",
    };
  }
  return { superficie: "cliente" as const, cookieEntrada: NOMBRE_COOKIE_ENTRADA, ruta: RUTA_SEGUNDO_FACTOR };
}
