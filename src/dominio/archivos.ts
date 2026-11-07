/**
 * Tope de un archivo que sube una persona: documentos del expediente, la lista de
 * personas bloqueadas, constancias, contratos y documentos de proveedores (si son
 * dos en un envío, entre los dos). Vercel corta en 4.5 MB todo el cuerpo de la
 * petición, con un 413 antes de llegar a la acción: 4 MB deja margen para los
 * demás campos. La etiqueta, el aviso y la revisión del navegador citan esta cifra.
 */
export const TOPE_ARCHIVO_BYTES = 4_000_000;

export const TOPE_ARCHIVO_TEXTO = "4 MB";
