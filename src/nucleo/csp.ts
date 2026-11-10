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

/** Las descargas de documentos responden con su propia política aislada (sandbox). */
export function esDescarga(patron: string): boolean {
  return /\/documento\/\[[A-Za-z]+\]$/.test(patron);
}
