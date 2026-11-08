import { errorConSecreto } from "@/server/entrada";
import { contextoOperacion } from "@/server/operacion";
import { encabezadosDescarga } from "@/server/pagos-proveedores/descarga";
import { actaEnPdf } from "@/server/pld";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

/** El acta de la sesión que genera Lever (48ª), para que la firmen el presidente y el secretario. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const noDisponible = () => new Response("Acta no disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  try {
    const ctx = await contextoOperacion();
    if (!ctx) return noDisponible();
    const { id } = await params;
    const acta = await actaEnPdf(ctx, id);
    return new Response(acta.bytes as unknown as BodyInit, {
      headers: encabezadosDescarga({ nombre: acta.nombre, tipo: "application/pdf", peso: acta.bytes.byteLength }),
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return noDisponible();
    throw error;
  }
}
