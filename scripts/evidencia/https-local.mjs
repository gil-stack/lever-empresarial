// Origen https local delante de `next start`, solo para la evidencia en WebKit:
// WebKit no manda la cookie __Host-sesion (Secure) por http local, y desviarla
// con page.route pierde los archivos de los formularios. Con https la manda sola.
//
//   openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
//     -addext subjectAltName=DNS:localhost -keyout <fuera-del-repo>/llave.pem -out <fuera-del-repo>/cert.pem
//   LLAVE=<…>/llave.pem CERT=<…>/cert.pem DESDE=3182 HACIA=3181 node scripts/evidencia/https-local.mjs
//
// Escucha solo en 127.0.0.1 y reenvía tal cual (el Host no cambia, así el
// origen de las acciones de servidor coincide). La llave nunca va al repositorio.

import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";

const { LLAVE, CERT } = process.env;
const DESDE = Number(process.env.DESDE ?? "3182");
const HACIA = Number(process.env.HACIA ?? "3181");
if (!LLAVE || !CERT || LLAVE.includes("/docs/") || CERT.includes("/docs/")) throw new Error("LLAVE y CERT tienen que existir y estar fuera del repositorio.");

createServer({ key: readFileSync(LLAVE), cert: readFileSync(CERT) }, (entrada, salida) => {
  const reenvio = request({ host: "127.0.0.1", port: HACIA, path: entrada.url, method: entrada.method, headers: entrada.headers }, (respuesta) => {
    salida.writeHead(respuesta.statusCode ?? 502, respuesta.headers);
    respuesta.pipe(salida);
  });
  reenvio.on("error", () => {
    salida.writeHead(502);
    salida.end();
  });
  entrada.pipe(reenvio);
}).listen(DESDE, "127.0.0.1", () => console.log(`https://localhost:${DESDE} → http://127.0.0.1:${HACIA}`));
