import { correrAlertasDeCaja } from "@/server/flujo/alertas-caja";
import { autorizada } from "@/server/flujo/correo-semanal";
import { ErrorDeDominio } from "@/nucleo/error-de-dominio";

export const runtime = "nodejs";
// La tarea deja de empezar empresas a los 240 s; la siguiente corrida toma las pendientes.
export const maxDuration = 300;

/**
 * Tarea programada de Vercel (vercel.json, cada 15 minutos de 13:00 a 3:45 UTC
 * = de 7:00 a 21:45 en el centro de México): foto semanal del runway y avisos
 * de caja. Vercel llama con `Authorization: Bearer <CRON_SECRET>`. Sin el
 * secreto, o con otro, responde 401 y no toca la base.
 */
export async function GET(request: Request): Promise<Response> {
  if (!autorizada(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return respuesta({ error: "no_autorizada" }, 401);
  }
  try {
    return respuesta(await correrAlertasDeCaja(), 200);
  } catch (error) {
    const codigo = error instanceof ErrorDeDominio ? error.codigo : "desconocido";
    console.error(JSON.stringify({ nivel: "error", origen: "tareas.caja", evento: "tarea_fallida", codigo }));
    return respuesta({ error: codigo }, 500);
  }
}

function respuesta(cuerpo: unknown, estado: number): Response {
  return Response.json(cuerpo, { status: estado, headers: { "cache-control": "no-store" } });
}
