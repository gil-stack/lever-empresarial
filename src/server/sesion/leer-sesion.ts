import "server-only";
import { connection } from "next/server";

export type Sesion = {
  usuarioId: string;
  empresaId: string;
};

/**
 * Hueco. La sesión viaja en cookie HttpOnly, Secure y SameSite.
 * La base guarda el hash del token, no el token.
 * `connection()` deja esta lectura en el request: hoy no hay cookie
 * ni hash, y la función devuelve null para el estado vacío.
 * El identificador de empresa que mande el navegador no autoriza.
 */
export async function leerSesion(): Promise<Sesion | null> {
  await connection();
  return null;
}
