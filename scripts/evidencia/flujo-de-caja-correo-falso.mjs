// Proveedor de correo falso para el recorrido local del flujo de caja.
//
//   NODE_OPTIONS="--import=./scripts/evidencia/flujo-de-caja-correo-falso.mjs" \
//   CORREO_FALSO_ARCHIVO=/ruta/fuera/del/repo/correos.jsonl npx next start -p 4806
//
// Solo intercepta POST https://api.resend.com/emails: anota el mensaje (para,
// asunto, llave de idempotencia, texto y html) en CORREO_FALSO_ARCHIVO y
// responde como Resend. Respeta la llave de idempotencia igual que Resend: la
// misma llave con el mismo contenido responde lo mismo sin anotar otro correo, y
// con otro contenido responde 409 `invalid_idempotent_request`. Todo lo demás
// sigue al fetch real. El código de la aplicación no cambia.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const ARCHIVO = process.env.CORREO_FALSO_ARCHIVO ?? "";
if (!ARCHIVO || ARCHIVO.includes("/docs/")) {
  throw new Error("CORREO_FALSO_ARCHIVO tiene que ser un archivo fuera del repositorio.");
}

const original = globalThis.fetch;
const huella = (m) => createHash("sha256").update(JSON.stringify([m.para, m.asunto, m.texto, m.html])).digest("hex");
/** Llave de idempotencia → huella del contenido con que se usó. */
const vistas = new Map(
  existsSync(ARCHIVO)
    ? readFileSync(ARCHIVO, "utf8").split("\n").filter(Boolean).map((linea) => {
        const m = JSON.parse(linea);
        return [m.idempotencia, huella(m)];
      })
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
    const mensaje = { para: cuerpo.to, asunto: cuerpo.subject, texto: cuerpo.text, html: cuerpo.html };
    const previa = vistas.get(idempotencia);
    if (previa !== undefined && previa !== huella(mensaje)) {
      return new Response(
        JSON.stringify({ statusCode: 409, name: "invalid_idempotent_request", message: "This idempotency key has been used with a different request body." }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    }
    if (previa === undefined) {
      vistas.set(idempotencia, huella(mensaje));
      appendFileSync(ARCHIVO, `${JSON.stringify({ en: new Date().toISOString(), ...mensaje, idempotencia })}\n`);
    }
    return new Response(JSON.stringify({ id: `falso_${vistas.size}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return original(entrada, init);
};
