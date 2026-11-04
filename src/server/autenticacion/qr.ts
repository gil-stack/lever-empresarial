import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * El QR del alta TOTP, como SVG en una data URI. Negro sobre blanco en los
 * dos temas: una app autenticadora no siempre lee un QR invertido. No se
 * guarda. La semilla solo vive en esa respuesta.
 */
export async function qrComoDataUri(texto: string): Promise<string> {
  try {
    const modulo = (await import("qrcode")) as {
      toString?: (texto: string, opciones: Record<string, unknown>) => Promise<string>;
      default?: { toString?: (texto: string, opciones: Record<string, unknown>) => Promise<string> };
    };
    const generar = modulo.toString ?? modulo.default?.toString;
    if (typeof generar !== "function") throw new Error("qr");
    const svg = await generar(texto, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  } catch {
    throw new ErrorDeDominio("qr_no_disponible");
  }
}
