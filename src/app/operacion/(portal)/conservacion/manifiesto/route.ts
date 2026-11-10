import { errorConSecreto } from "@/server/entrada";
import { contextoOperacion } from "@/server/operacion";
import { POLITICA_DESCARGA } from "@/server/pagos-proveedores/descarga";
import { manifiestoDeConservacion } from "@/server/pld";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

const CAMPOS = ["companyId", "desde", "hasta", "pagina", "despuesEn", "despuesId"] as const;

/**
 * 61ª: el manifiesto de conservación de una empresa en un periodo, en streaming
 * (NDJSON) y por páginas de 2,000 documentos, para no pasar los 4.5 MB de una
 * respuesta. Cada página deja su evento en la bitácora antes de salir.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Inventario de la ronda 12: vuelve con lo que se eligió (ya venía en esta dirección: empresa, fechas, página y cursor).
  // r2-serv-N20: sin fragmento, como toda dirección de Operación: con él, el navegador descarta el autofocus del campo.
  const volver = (aviso: string) => {
    const regreso = new URL("/operacion/conservacion", request.url);
    regreso.searchParams.set("aviso", aviso);
    regreso.searchParams.set("en", "manifiesto-titulo");
    for (const campo of CAMPOS) {
      const valor = url.searchParams.get(campo);
      if (valor) regreso.searchParams.set(campo, valor);
    }
    return Response.redirect(regreso, 303);
  };
  try {
    const ctx = await contextoOperacion();
    if (!ctx) return new Response("No disponible", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const companyId = url.searchParams.get("companyId") ?? "";
    const desde = url.searchParams.get("desde") ?? "";
    const hasta = url.searchParams.get("hasta") ?? "";
    // r2-serv-N23 y N24: la página y el cursor van tal cual al servidor, que los revisa antes de la base; el cursor
    // no pasa por Date (perdía los microsegundos).
    const textoPagina = (url.searchParams.get("pagina") ?? "").trim() || "1";
    const pagina = /^\d{1,10}$/.test(textoPagina) ? Number(textoPagina) : Number.NaN;
    const despuesEn = (url.searchParams.get("despuesEn") ?? "").trim();
    const despuesId = (url.searchParams.get("despuesId") ?? "").trim();
    const cursor = despuesEn || despuesId ? { despuesEn, despuesId } : null;
    const lineas = manifiestoDeConservacion(ctx, { companyId, desde, hasta, pagina, cursor });
    // La primera línea sale antes de responder: un permiso o un periodo inválido vuelven a la pantalla con su aviso.
    const primera = await lineas.next();
    const codificador = new TextEncoder();
    const cuerpo = new ReadableStream<Uint8Array>({
      start(control) {
        if (!primera.done) control.enqueue(codificador.encode(primera.value));
      },
      async pull(control) {
        const siguiente = await lineas.next();
        if (siguiente.done) control.close();
        else control.enqueue(codificador.encode(siguiente.value));
      },
      async cancel() {
        await lineas.return(undefined);
      },
    });
    const nombre = `manifiesto-conservacion-${desde}-${hasta}-pagina-${pagina}.ndjson`;
    return new Response(cuerpo, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        "Content-Security-Policy": POLITICA_DESCARGA,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ErrorDeDominio) return volver(error.codigo);
    if (errorConSecreto(error)) return volver("base_no_disponible");
    throw error;
  }
}
