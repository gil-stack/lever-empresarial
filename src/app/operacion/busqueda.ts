/**
 * Los parámetros de la dirección de una página de Operación, como los entrega Next: una clave repetida
 * (`?aviso=a&aviso=b`) llega como lista, no como texto.
 */
export type Parametros<Clave extends string> = Promise<Partial<Record<Clave, string | string[]>>>;

/**
 * Cada parámetro como texto, o fuera. Con una lista, `aviso.startsWith` o `faltan.split` tumbaban la página con un
 * 500. Una clave repetida se descarta, como si no viniera: la página se ve sin aviso ni campo marcado.
 */
export async function soloTexto<Clave extends string>(busqueda: Parametros<Clave>): Promise<Partial<Record<Clave, string>>> {
  const crudos = await busqueda;
  const limpios: Partial<Record<Clave, string>> = {};
  for (const clave of Object.keys(crudos) as Clave[]) {
    const valor = crudos[clave];
    if (typeof valor === "string") limpios[clave] = valor;
  }
  return limpios;
}
