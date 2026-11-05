/**
 * Encabezados de la descarga de un documento de proveedor o de pago. El archivo
 * siempre baja como adjunto y nunca se interpreta en el origen de la aplicación:
 * el XML sale como octet-stream y la política de contenido aísla la respuesta.
 */
export function encabezadosDescarga(documento: { nombre: string; tipo: string; peso: number }): Record<string, string> {
  return {
    "Content-Type": documento.tipo === "application/pdf" ? "application/pdf" : "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(documento.nombre)}`,
    "Content-Length": String(documento.peso),
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}
