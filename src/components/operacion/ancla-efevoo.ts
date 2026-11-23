/**
 * El ancla de una tarjeta en «Tarjetas»: el id interno de la tarjeta, no su terminación. Dos tarjetas de
 * la misma empresa pueden tener los mismos últimos 4 y repetirían el `id` en el HTML.
 */
export function anclaDeTarjeta(tarjeta: { id: string; terminacion: string }): string {
  return `tarjeta-${tarjeta.id}`;
}
