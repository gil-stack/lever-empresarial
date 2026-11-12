import { descargarComprobante } from "@/server/cobranza/servicio";
import { contextoDeAccion, errorConSecreto } from "@/server/entrada";
import { encabezadosDescarga } from "@/server/pagos-proveedores/descarga";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const documento = await descargarComprobante(await contextoDeAccion(), id);
    return new Response(documento.bytes as unknown as BodyInit, {
      headers: encabezadosDescarga({ nombre: documento.nombre, tipo: documento.tipo, peso: documento.bytes.byteLength }),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return new Response("Comprobante no disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    throw error;
  }
}
