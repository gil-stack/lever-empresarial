// Proveedor de correo falso de los recorridos de navegador. Se carga en `next start`
// con NODE_OPTIONS=--import, solo desde tests/e2e/entorno.ts. Fuera del servidor de una
// prueba local truena (../guarda-preload.mjs). Sin E2E_CORREO_ARCHIVO no hace nada.
//
// Solo intercepta POST https://api.resend.com/emails (src/server/correo/resend.ts usa el
// fetch global): anota el mensaje en E2E_CORREO_ARCHIVO, una línea JSON por correo, y
// responde como Resend. La misma llave de idempotencia responde lo mismo sin anotar otro
// correo, como Resend. Un destinatario de @rebota-e2e.mx responde 422 (el correo no sale).
// Nada sale a la red; todo lo demás sigue al fetch real.
import { appendFileSync } from "node:fs";

import { exigirEntornoDePrueba } from "../guarda-preload.mjs";

exigirEntornoDePrueba("El correo falso de los recorridos");
const archivo = process.env.E2E_CORREO_ARCHIVO;

if (archivo) {
  const original = globalThis.fetch;
  const vistas = new Set();

  const encabezado = (init, nombre) => {
    const h = init?.headers;
    if (!h) return null;
    if (typeof h.get === "function") return h.get(nombre);
    const clave = Object.keys(h).find((k) => k.toLowerCase() === nombre.toLowerCase());
    return clave ? h[clave] : null;
  };

  globalThis.fetch = async function fetchConCorreoLocal(entrada, init) {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada?.url;
    if (url === "https://api.resend.com/emails" && (init?.method ?? "GET").toUpperCase() === "POST") {
      const cuerpo = JSON.parse(String(init.body));
      // Un destinatario de @rebota-e2e.mx no se entrega: Resend responde 422 y el envío queda «fallido» (alta-clientes.spec).
      if ((Array.isArray(cuerpo.to) ? cuerpo.to : [cuerpo.to]).some((para) => String(para).endsWith("@rebota-e2e.mx"))) {
        return new Response(JSON.stringify({ name: "validation_error", message: "rebota" }), { status: 422, headers: { "content-type": "application/json" } });
      }
      const idempotencia = encabezado(init, "Idempotency-Key") ?? "";
      if (!vistas.has(idempotencia)) {
        vistas.add(idempotencia);
        const para = Array.isArray(cuerpo.to) ? cuerpo.to : [cuerpo.to];
        appendFileSync(archivo, `${JSON.stringify({ para, asunto: cuerpo.subject, texto: cuerpo.text, html: cuerpo.html, idempotencia })}\n`);
      }
      return new Response(JSON.stringify({ id: `local_${vistas.size}` }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return original(entrada, init);
  };
}
