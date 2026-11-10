import { correrCobranza } from "@/server/cobranza/tarea";
import { autorizada } from "@/server/flujo/correo-semanal";
import { ErrorDeDominio } from "@/nucleo/error-de-dominio";

export const runtime = "nodejs";
// La tarea deja de empezar empresas a los 240 s; la siguiente corrida toma las pendientes.
export const maxDuration = 300;

/**
 * Tarea programada de Vercel (vercel.json, diario 14:00 y 18:00 UTC = 8:00 y
 * 12:00 en el centro de México; la segunda solo encuentra lo que faltó).
 * Vercel llama con `Authorization: Bearer <CRON_SECRET>`. Sin el secreto, o con
 * otro, responde 401 y no toca la base.
 */
export async function GET(request: Request): Promise<Response> {
  if (!autorizada(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return respuesta({ error: "no_autorizada" }, 401);
  }
  try {
    return respuesta(await correrCobranza(), 200);
  } catch (error) {
    const codigo = error instanceof ErrorDeDominio ? error.codigo : "desconocido";
    console.error(JSON.stringify({ nivel: "error", origen: "tareas.cobranza", evento: "tarea_fallida", codigo }));
    return respuesta({ error: codigo }, 500);
  }
}

function respuesta(cuerpo: unknown, estado: number): Response {
  return Response.json(cuerpo, { status: estado, headers: { "cache-control": "no-store" } });
}
