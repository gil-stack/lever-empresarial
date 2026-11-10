import { auditar } from "@/server/bitacora/auditar";
import { atenderAviso, configFintoc, TOPE_CUERPO } from "@/server/cobranza/fintoc";

export const runtime = "nodejs";

/**
 * Aviso de Fintoc (`transfer.inbound.succeeded`). Sin llaves configuradas
 * responde 404. Firma inválida o vieja: 400. El mismo evento otra vez: 200 sin
 * efecto. Lo demás lo decide `atenderAviso`.
 */
export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? "0") > TOPE_CUERPO) return respuesta({ error: "muy_grande" }, 413);
  let cuerpo: Uint8Array;
  try {
    cuerpo = await leerConTope(request, TOPE_CUERPO + 1);
  } catch {
    return respuesta({ error: "aviso_ilegible" }, 400);
  }
  try {
    const r = await atenderAviso(cuerpo, request.headers.get("fintoc-signature"), { config: configFintoc(), ahora: () => new Date(), auditar });
    return respuesta(r.cuerpo, r.estado);
  } catch {
    // Sin detalles al remitente; Fintoc reintenta y el evento se puede recuperar con su API de eventos.
    console.error(JSON.stringify({ nivel: "error", origen: "cobranza.fintoc", evento: "aviso_fallido" }));
    return respuesta({ error: "no_disponible" }, 500);
  }
}

/** Lee el cuerpo sin pasar de `tope` bytes, aunque el remitente mienta en Content-Length. */
async function leerConTope(request: Request, tope: number): Promise<Uint8Array> {
  const lector = request.body?.getReader();
  if (!lector) return new Uint8Array(0);
  const partes: Uint8Array[] = [];
  let largo = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    largo += value.byteLength;
    if (largo > tope) {
      await lector.cancel();
      break;
    }
    partes.push(value);
  }
  const cuerpo = new Uint8Array(Math.min(largo, tope));
  let i = 0;
  for (const parte of partes) {
    cuerpo.set(parte.subarray(0, cuerpo.byteLength - i), i);
    i += parte.byteLength;
  }
  return cuerpo;
}

function respuesta(cuerpo: unknown, estado: number): Response {
  return Response.json(cuerpo, { status: estado, headers: { "cache-control": "no-store" } });
}
