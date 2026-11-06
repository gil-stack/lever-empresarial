// Proveedor de correo falso para el recorrido local del flujo de caja.
//
//   NODE_OPTIONS="--import=./scripts/evidencia/flujo-de-caja-correo-falso.mjs" \
//   CORREO_FALSO_ARCHIVO=/ruta/fuera/del/repo/correos.jsonl npx next start -p 4806
//
// Solo intercepta POST https://api.resend.com/emails: anota el mensaje (para,
// asunto, llave de idempotencia, texto y html) en CORREO_FALSO_ARCHIVO y
// responde como Resend. Respeta la llave de idempotencia igual que Resend: la
// misma llave no anota un segundo correo. Todo lo demás sigue al fetch real. El
// código de la aplicación no cambia.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const ARCHIVO = process.env.CORREO_FALSO_ARCHIVO ?? "";
if (!ARCHIVO || ARCHIVO.includes("/docs/")) {
  throw new Error("CORREO_FALSO_ARCHIVO tiene que ser un archivo fuera del repositorio.");
}

const original = globalThis.fetch;
const vistas = new Set(
  existsSync(ARCHIVO)
    ? readFileSync(ARCHIVO, "utf8").split("\n").filter(Boolean).map((linea) => JSON.parse(linea).idempotencia)
    : [],
);

function encabezado(init, nombre) {
  const h = init?.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(nombre);
  const clave = Object.keys(h).find((k) => k.toLowerCase() === nombre.toLowerCase());
  return clave ? h[clave] : null;
}

globalThis.fetch = async function fetchConCorreoFalso(entrada, init) {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada?.url;
  if (url === "https://api.resend.com/emails" && (init?.method ?? "GET").toUpperCase() === "POST") {
    const cuerpo = JSON.parse(String(init.body));
    const idempotencia = encabezado(init, "Idempotency-Key");
    if (!vistas.has(idempotencia)) {
      vistas.add(idempotencia);
      appendFileSync(
        ARCHIVO,
        `${JSON.stringify({ en: new Date().toISOString(), para: cuerpo.to, asunto: cuerpo.subject, idempotencia, texto: cuerpo.text, html: cuerpo.html })}\n`,
      );
    }
    return new Response(JSON.stringify({ id: `falso_${vistas.size}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return original(entrada, init);
};
