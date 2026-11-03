import "server-only";

/**
 * Hueco. Las migraciones numeradas todavía no están en el repositorio.
 * Quien las escriba las corre con un comando explícito y el connection
 * string directo. Este módulo no se llama al arrancar el servidor.
 */
export function aplicarMigraciones(): never {
  throw new Error("migraciones_no_implementadas");
}
