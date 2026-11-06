import { autorizada, enviarCorreosSemanales } from "@/server/flujo/correo-semanal";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

/**
 * Tarea programada de Vercel (vercel.json, lunes 14:00 UTC = 8:00 en el centro
 * de México). Vercel llama con `Authorization: Bearer <CRON_SECRET>`. Sin el
 * secreto configurado, o con otro, responde 401 y no toca la base.
 */
export async function GET(request: Request): Promise<Response> {
  if (!autorizada(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return respuesta({ error: "no_autorizada" }, 401);
  }
  try {
    return respuesta(await enviarCorreosSemanales(), 200);
  } catch (error) {
    const codigo = error instanceof ErrorDeDominio ? error.codigo : "desconocido";
    console.error(JSON.stringify({ nivel: "error", origen: "tareas.correo_semanal", evento: "tarea_fallida", codigo }));
    return respuesta({ error: codigo }, 500);
  }
}

function respuesta(cuerpo: unknown, estado: number): Response {
  return Response.json(cuerpo, { status: estado, headers: { "cache-control": "no-store" } });
}
