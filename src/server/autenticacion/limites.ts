import { createHash, createHmac } from "node:crypto";

/**
 * Límites de contraseña por cuenta + IP y por IP (0045). Ningún bloqueo es
 * permanente y ninguno se nota en la respuesta: el rechazo es el mismo texto y
 * tarda lo mismo que una contraseña mala (PISO_RECHAZO_MS en servicio.ts).
 *
 * Cuenta + IP: los primeros cinco fallos seguidos no esperan; desde el quinto,
 * la pareja espera 1, 2, 4, 8 y 16 minutos, y luego 30 como máximo. Se mide desde
 * el último fallo y un acierto la reinicia. Desde otra IP no se deja fuera a nadie.
 *
 * IP: treinta correos distintos con fallos en quince minutos desde una salida es
 * una lista de cuentas probándose; la salida espera hasta que baje. Una cuenta que
 * ya entró antes desde esa salida no espera: una oficina detrás de una misma IP
 * sigue entrando aunque alguien de adentro esté probando cuentas.
 */

export const LIBRES_POR_PAREJA = 5;
export const ESPERA_INICIAL_MS = 60 * 1000;
export const ESPERA_MAXIMA_MS = 30 * 60 * 1000;
export const CUENTAS_POR_IP = 30;

export type EstadoIntentos = {
  /** Fallos de la pareja en 24 horas desde su último acierto. */
  fallosPareja: number;
  ultimaFalla: Date | null;
  /** Correos distintos con fallos desde la IP en quince minutos. */
  cuentasIp: number;
  /** La cuenta ya entró desde esa IP en los últimos noventa días. */
  ipConocida: boolean;
};

/** Cuánto espera la pareja después de `fallos` fallos seguidos. */
export function esperaDePareja(fallos: number): number {
  if (fallos < LIBRES_POR_PAREJA) return 0;
  const doblado = ESPERA_INICIAL_MS * 2 ** Math.min(fallos - LIBRES_POR_PAREJA, 10);
  return Math.min(doblado, ESPERA_MAXIMA_MS);
}

export function intentoDetenido(estado: EstadoIntentos, ahora: Date): boolean {
  const espera = esperaDePareja(estado.fallosPareja);
  if (espera > 0 && estado.ultimaFalla && ahora.getTime() < estado.ultimaFalla.getTime() + espera) return true;
  return estado.cuentasIp >= CUENTAS_POR_IP && !estado.ipConocida;
}

/**
 * La IP de la petición. En Vercel, `x-real-ip` y el primer valor de
 * `x-forwarded-for` los pone la plataforma; quien llama no los puede fijar.
 * Sin ninguno de los dos (pruebas, un comando) no hay límite por IP.
 */
export function ipDeEncabezados(encabezados: { get(nombre: string): string | null }): string | null {
  const candidata = encabezados.get("x-real-ip") ?? encabezados.get("x-forwarded-for")?.split(",")[0] ?? "";
  const limpia = candidata.trim().toLowerCase();
  return /^[0-9a-f:.]{2,45}$/.test(limpia) ? limpia : null;
}

/** HMAC-SHA256 con la llave del servidor: la tabla no guarda correo ni IP en claro. */
export function huella(tipo: "correo" | "ip", valor: string, llave: Buffer | null): string {
  const mensaje = `lever.intentos.${tipo}:${valor}`;
  if (llave) return createHmac("sha256", llave).update(mensaje).digest("hex");
  return createHash("sha256").update(mensaje).digest("hex");
}
