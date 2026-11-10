import "server-only";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { cache } from "react";

/**
 * La página que responde a un envío sin JavaScript: es la única petición que pide un documento (`Accept: text/html`) con
 * cuerpo de formulario (multipart). La acción con JavaScript pide `text/x-component`, también cuando Next pinta la página
 * de destino de su redirección con los encabezados del envío.
 */
export const esRespuestaDeEnvio = cache(async () => {
  const encabezados = await headers();
  return (encabezados.get("accept") ?? "").includes("text/html") && (encabezados.get("content-type") ?? "").startsWith("multipart/form-data");
});

/** Un sufijo por respuesta a un envío sin JavaScript (el mismo para todos los destinos de esa página); si no, ninguno. */
const sufijoDeEnvio = cache(async () => ((await esRespuestaDeEnvio()) ? randomUUID().slice(0, 8) : null));

/**
 * El id de un destino de fragmento (`#contenido` de «Saltar al contenido», `#dictamen-titulo` de un enlace de
 * Cumplimiento). Sin JavaScript, el envío va a la dirección del documento con todo y fragmento y, si la página que
 * responde tiene ese destino, el navegador descarta el autofocus: el foco no llegaría al campo rechazado. En la respuesta
 * a un envío sin JavaScript el id lleva un sufijo nuevo, así ningún fragmento anterior coincide; quien enlaza dentro de
 * esa página (el marco) y quien lo pinta lo leen de la misma petición (`cache`). Con JavaScript, el id tal cual.
 * El `permalink` de useActionState no sirve: con él, la llave del estado es la dirección y las tarjetas repetidas de una
 * página (coincidencias, folios, recuperaciones) compartirían el rechazo.
 */
export async function idDeAncla(id: string): Promise<string> {
  const sufijo = await sufijoDeEnvio();
  return sufijo ? `${id}-${sufijo}` : id;
}
