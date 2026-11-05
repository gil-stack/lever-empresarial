import { descargarDocumentoProveedor } from "@/server/pagos-proveedores";
import { contextoDeAccion, errorConSecreto } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const documento = await descargarDocumentoProveedor(await contextoDeAccion(), id);
    return new Response(documento.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": documento.tipo,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(documento.nombre)}`,
        "Content-Length": String(documento.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return new Response("Documento no disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    throw error;
  }
}
