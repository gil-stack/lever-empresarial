import "server-only";

/**
 * Hueco. Cuando exista, el servidor usa el connection string agrupado.
 * Las migraciones no pasan por aquí: usan el string directo, en un
 * comando explícito. Este proceso no migra al arrancar.
 * No imprimir la configuración. No importar este archivo desde el cliente.
 */
export function obtenerLibro(): never {
  throw new Error("conexion_no_implementada");
}
