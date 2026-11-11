import { errorConSecreto } from "@/server/entrada";
import { contextoOperacion } from "@/server/operacion";
import { encabezadosDescarga } from "@/server/pagos-proveedores/descarga";
import { descargarActa } from "@/server/pld";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

/** Descarga el acta firmada. La base deja el evento antes de entregar la ruta y la huella se compara con la guardada. */
export async function GET(_request: Request, { params }: { params: Promise<{ actaId: string }> }) {
  const noDisponible = () => new Response("Acta no disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  try {
    const ctx = await contextoOperacion();
    if (!ctx) return noDisponible();
    const { actaId } = await params;
    const acta = await descargarActa(ctx, actaId);
    return new Response(acta.bytes as unknown as BodyInit, {
      headers: encabezadosDescarga({ nombre: acta.nombre, tipo: acta.tipo, peso: acta.bytes.byteLength }),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return noDisponible();
    throw error;
  }
}
