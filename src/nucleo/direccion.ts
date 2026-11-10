/**
 * Los parámetros de la dirección de una página, como los entrega Next: una clave repetida (`?aviso=a&aviso=b`,
 * `?q=a&q=b`) llega como lista, no como texto. Sin clave, cualquier nombre.
 */
export type Parametros<Clave extends string = string> = Promise<Partial<Record<Clave, string | string[]>>>;

/**
 * Cada parámetro como texto, o fuera. Con una lista, `aviso.startsWith`, `faltan.split` o `q.trim()` tumbaban la
 * página con un 500, y un `pago` repetido se leía como uno que no existe (404). Una clave repetida se descarta, como
 * si no viniera: la página se ve sin aviso ni filtro. Lo usan el portal y Operación.
 */
export async function soloTexto<Clave extends string = string>(busqueda: Parametros<Clave>): Promise<Partial<Record<Clave, string>>> {
  const crudos = await busqueda;
  const limpios: Partial<Record<Clave, string>> = {};
  for (const clave of Object.keys(crudos) as Clave[]) {
    const valor = crudos[clave];
    if (typeof valor === "string") limpios[clave] = valor;
  }
  return limpios;
}
