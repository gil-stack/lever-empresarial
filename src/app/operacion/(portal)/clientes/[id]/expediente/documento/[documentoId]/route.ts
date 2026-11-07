import { errorConSecreto } from "@/server/entrada";
import { contextoOperacion, descargarDocumentoExpediente } from "@/server/operacion";
import { encabezadosDescarga } from "@/server/pagos-proveedores/descarga";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

/**
 * Descarga un documento del expediente. La base deja el evento antes de entregar la ruta
 * (lectura auditada) y el archivo baja como adjunto, aislado y sin caché.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ documentoId: string }> }) {
  const noDisponible = () => new Response("Documento no disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  try {
    const ctx = await contextoOperacion();
    if (!ctx) return noDisponible();
    const { documentoId } = await params;
    const documento = await descargarDocumentoExpediente(ctx, documentoId);
    return new Response(documento.bytes as unknown as BodyInit, {
      headers: encabezadosDescarga({ nombre: documento.nombre, tipo: documento.tipo, peso: documento.bytes.byteLength }),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return noDisponible();
    throw error;
  }
}
