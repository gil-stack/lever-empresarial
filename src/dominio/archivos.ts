/**
 * Tope de un archivo que sube una persona: documentos del expediente, la lista de
 * personas bloqueadas, constancias, contratos y documentos de proveedores (si son
 * dos en un envío, entre los dos). Vercel corta en 4.5 MB todo el cuerpo de la
 * petición, con un 413 antes de llegar a la acción. 4 MiB (4 194 304 bytes) deja
 * 512 KiB bajo el límite de Next ("4.5mb" = 4 718 592) y unos 298 KiB aun si los
 * 4.5 MB de Vercel fueran decimales; cabe una lista de 50 000 renglones. La
 * etiqueta, el aviso y la revisión del navegador citan esta cifra.
 */
export const TOPE_ARCHIVO_BYTES = 4 * 1024 * 1024;

export const TOPE_ARCHIVO_TEXTO = "4 MB";
