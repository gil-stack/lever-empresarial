import { errorConSecreto } from "@/server/entrada";
import { contextoOperacion } from "@/server/operacion";
import { encabezadosDescarga } from "@/server/pagos-proveedores/descarga";
import { descargarDocumentoPld } from "@/server/pld";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

/**
 * Descarga un documento de soporte de un caso de PLD. La base deja el evento
 * antes de entregar la ruta (lectura auditada) y la huella se compara con la
 * guardada; la persona excluida de un aviso no lo descarga (60ª).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentoId: string }> }) {
  const noDisponible = () => new Response("Documento no disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  try {
    const ctx = await contextoOperacion();
    if (!ctx) return noDisponible();
    const { documentoId } = await params;
    const documento = await descargarDocumentoPld(ctx, documentoId);
    return new Response(documento.bytes as unknown as BodyInit, {
      headers: encabezadosDescarga({ nombre: documento.nombre, tipo: documento.tipo, peso: documento.bytes.byteLength }),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return noDisponible();
    throw error;
  }
}
