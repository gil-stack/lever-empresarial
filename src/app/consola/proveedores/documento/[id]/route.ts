import { descargarDocumentoProveedor } from "@/server/pagos-proveedores";
import { encabezadosDescarga } from "@/server/pagos-proveedores/descarga";
import { contextoDeAccion, errorConSecreto } from "@/server/entrada";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const documento = await descargarDocumentoProveedor(await contextoDeAccion(), id);
    return new Response(documento.bytes as unknown as BodyInit, {
      headers: encabezadosDescarga({ nombre: documento.nombre, tipo: documento.tipo, peso: documento.bytes.byteLength }),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return new Response("Documento no disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    throw error;
  }
}
