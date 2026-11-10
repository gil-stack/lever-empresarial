/** Los parámetros de la dirección como los entrega Next: una clave repetida (`?q=a&q=b`) llega como lista. */
export type Direccion = Promise<Record<string, string | string[] | undefined>>;

/**
 * Cada parámetro como texto, o fuera. Con una lista, `q.trim()` en el servidor de Proveedores respondía 500 y un
 * `pago` repetido se leía como uno que no existe (404). Una clave repetida se descarta, como si no viniera: el mismo
 * criterio que Personas y que `soloTexto` de Operación.
 */
export async function soloTexto(busqueda: Direccion): Promise<Record<string, string | undefined>> {
  const crudos = await busqueda;
  return Object.fromEntries(Object.entries(crudos).filter((par): par is [string, string] => typeof par[1] === "string"));
}
