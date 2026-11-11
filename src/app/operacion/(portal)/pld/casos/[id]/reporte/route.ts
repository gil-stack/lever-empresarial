import { errorConSecreto } from "@/server/entrada";
import { contextoOperacion } from "@/server/operacion";
import { POLITICA_DESCARGA } from "@/server/pagos-proveedores/descarga";
import { contenidoDelReporte } from "@/server/pld";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

/**
 * Borrador del reporte de operación inusual (tipo 2) o interna preocupante (tipo 3)
 * con el layout de 41 columnas del DOF. Lever no lo transmite: el Oficial lo completa
 * con los catálogos de la CNBV y lo presenta en el SITI.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const noDisponible = () => new Response("Reporte no disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  try {
    const ctx = await contextoOperacion();
    if (!ctx) return noDisponible();
    const { id } = await params;
    const contenido = await contenidoDelReporte(ctx, id);
    const nombre = `borrador-reporte-tipo-${contenido.tipo}-${contenido.periodo}.txt`;
    const cuerpo = new TextEncoder().encode(contenido.renglon);
    return new Response(cuerpo as unknown as BodyInit, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        "Content-Length": String(cuerpo.byteLength),
        "Content-Security-Policy": POLITICA_DESCARGA,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return noDisponible();
    throw error;
  }
}
