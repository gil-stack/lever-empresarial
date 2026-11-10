/**
 * Política de contenido (CSP) con un nonce nuevo por petición. La arma el
 * proxy: la pone en la petición, de donde Next.js toma el nonce para sus
 * propios scripts y estilos, y en la respuesta, donde el navegador la aplica.
 * Todas las páginas se pintan por petición (el layout raíz lee la cookie del
 * tema), así que ninguna sale sin su nonce.
 *
 * - Scripts: solo los que traen el nonce y los que esos cargan
 *   ('strict-dynamic'). 'self' queda para navegadores sin CSP 3.
 * - Estilos: hojas propias y los <style> con nonce. Los atributos `style`
 *   que React pinta en el servidor (barras de las gráficas, menús flotantes)
 *   no pueden llevar nonce: se permiten solo como atributo (style-src-attr).
 * - Imágenes: propias, data: (los QR del segundo factor) y blob:.
 * - Las descargas de documentos no pasan por aquí: llevan su propia política
 *   aislada (sandbox) desde el manejador.
 */
export const CABECERA_CSP = "Content-Security-Policy";

/** El nonce de la petición, para los <style> que pinta la aplicación (el de Next lo pone Next). */
export const CABECERA_NONCE = "x-nonce";

export function nonceNuevo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function politicaDeContenido(nonce: string, desarrollo = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    // En desarrollo React usa eval para reconstruir las pilas del servidor; en producción no.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${desarrollo ? " 'unsafe-eval'" : ""}`,
    // En desarrollo Next inyecta estilos sin nonce.
    `style-src 'self' ${desarrollo ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Las descargas responden con su propia política aislada (sandbox): el documento de un proveedor y el del
 * expediente (`…/documento/[id]`) y el comprobante de un cobro (`…/comprobante/[id]`). Cada una necesita además
 * sus fuentes con POLITICA_DESCARGA en next.config (tests/operacion/encabezados.test.ts lo exige).
 */
const PATRON_DESCARGA = /\/(?:documento|comprobante)\/\[[A-Za-z]+\]$/;

export function esDescarga(patron: string): boolean {
  return PATRON_DESCARGA.test(patron);
}

/**
 * ¿La petición carga un documento? Solo ahí un <style> que pinta el servidor lleva
 * el nonce de la política del documento; en una navegación del cliente o una
 * acción de servidor llegaría con el de esa otra petición. Con Fetch Metadata lo
 * dice Sec-Fetch-Dest. Sin él (Safari anterior a 16.4), la carga de un documento
 * pide text/html y las peticiones RSC y las acciones no.
 */
export function esCargaDeDocumento(cabeceras: Pick<Headers, "get" | "has">): boolean {
  const destino = cabeceras.get("sec-fetch-dest");
  if (destino) return destino === "document";
  return !cabeceras.has("rsc") && !cabeceras.has("next-action") && (cabeceras.get("accept") ?? "").includes("text/html");
}
