import { errorConSecreto } from "@/server/entrada";
import { contextoOperacion } from "@/server/operacion";
import { POLITICA_DESCARGA } from "@/server/pagos-proveedores/descarga";
import { archivoRelevantes, constanciaInternacionales } from "@/server/pld";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

/**
 * El archivo de Relevantes (36ª) con el layout de 41 columnas o la constancia
 * interna de la 38ª. Cada descarga deja el evento «pld_archivo_generado». Sin la
 * clave de la entidad no hay archivo: la pantalla de reportes lo dice.
 */
export async function GET(request: Request) {
  const noDisponible = (status = 404) => new Response("Archivo no disponible", { status, headers: { "Cache-Control": "private, no-store" } });
  try {
    const ctx = await contextoOperacion();
    if (!ctx) return noDisponible();
    const url = new URL(request.url);
    const reporte = url.searchParams.get("reporte");
    const periodo = url.searchParams.get("periodo");
    if (reporte !== "36" && reporte !== "38") return noDisponible();
    const archivo = reporte === "36" ? await archivoRelevantes(ctx, periodo) : await constanciaInternacionales(ctx, periodo);
    const cuerpo = new TextEncoder().encode(archivo.texto);
    return new Response(cuerpo as unknown as BodyInit, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`,
        "Content-Length": String(cuerpo.byteLength),
        "Content-Security-Policy": POLITICA_DESCARGA,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.codigo === "falta_clave_entidad") {
      return Response.redirect(new URL("/operacion/reportes?aviso=falta_clave_entidad", request.url), 303);
    }
    if (error instanceof ErrorDeDominio && error.codigo === "periodo_sin_cerrar") {
      return Response.redirect(new URL("/operacion/reportes?aviso=periodo_sin_cerrar", request.url), 303);
    }
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return noDisponible();
    throw error;
  }
}
