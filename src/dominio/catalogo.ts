/**
 * Lo que dice un catálogo (avisos, mensajes, campos) para una clave que llega de fuera, como `?aviso=` de la dirección.
 * Solo cuentan las claves propias del catálogo: `catalogo[clave]` sobre un objeto literal también encuentra
 * `constructor`, `toString` o `__proto__` (heredados de Object.prototype), y pintarlos tumbaba la página con un 500.
 */
export function deCatalogo<T>(catalogo: Readonly<Record<string, T>>, clave: string | null | undefined): T | null {
  return typeof clave === "string" && Object.hasOwn(catalogo, clave) ? (catalogo[clave] as T) : null;
}
