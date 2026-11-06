// «SAT simulado» para la evidencia de Ola 1B: el DNS local no resuelve los
// hosts del SAT, así que este preload contesta por ellos. Solo vive en
// scripts/evidencia y no cambia el código de la aplicación.
//
//   NODE_OPTIONS="--import=./scripts/evidencia/ola1b-consola/sat-simulado.mjs" npx next start -p 4807
//
// - Resuelve *.sat.gob.mx a SAT_SIMULADO_IP (203.0.113.69 por omisión, una
//   dirección pública de documentación). La aplicación sigue validando el host
//   del SAT y que la IP no sea privada: con SAT_SIMULADO_IP=10.0.0.5 la carga
//   tiene que fallar sin pedir nada.
// - Contesta la página citada del SAT y el «Listado completo» del 69-B, con un
//   salto 302 dentro del SAT para que la validación de cada redirección corra.
// - Anota cada resolución y cada petición en SAT_SIMULADO_BITACORA.
// Lo demás (otros hosts, Blob, etc.) pasa sin cambios.
import { appendFileSync } from "node:fs";
import dnsPromesas from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";

const IP = process.env.SAT_SIMULADO_IP ?? "203.0.113.69";
const BITACORA = process.env.SAT_SIMULADO_BITACORA ?? null;
const PAGINA = "https://www.sat.gob.mx/minisitio/DatosAbiertos/contribuyentes_publicados.html";
const ENLACE = "https://omawww.sat.gob.mx/cifras_sat/Documents/Listado_Completo_69-B.csv";
const ARCHIVO = "https://omawww.sat.gob.mx/cifras_sat/Documents/simulado/Listado_Completo_69-B.csv";
const FECHA = "31 de octubre de 2026";

const HTML = `<!doctype html><html lang="es"><body>
<h2>Artículo 69-B del Código Fiscal de la Federación</h2>
<p><strong>Información actualizada al ${FECHA}.</strong></p>
<ul>
  <li><a href="${ENLACE.replace("Listado_Completo_69-B", "Definitivos")}">Definitivos</a></li>
  <li><a href="${ENLACE}">Listado completo</a></li>
</ul>
<h2>Artículo 69-B Bis del Código Fiscal de la Federación</h2>
<p><strong>Información actualizada al 9 de octubre de 2026.</strong></p>
<a href="https://omawww.sat.gob.mx/cifras_sat/Documents/Listado_69-B_Bis.csv">Listado completo</a>
</body></html>`;

const CSV = [
  `"Información actualizada al ${FECHA} (SAT simulado para la evidencia de Ola 1B)",,,`,
  "Listado completo de contribuyentes (Artículo 69-B del CFF)",
  "No,RFC,Nombre del Contribuyente,Situación del contribuyente",
  "1,PAL7202161U0,CONTRIBUYENTE SIMULADO UNO,Definitivo",
  "2,CABL840215RF4,CONTRIBUYENTE SIMULADO DOS,Presunto",
  "3,CABL840215RF4,CONTRIBUYENTE SIMULADO DOS,Sentencia Favorable",
].join("\r\n");

function anotar(linea) {
  if (BITACORA) appendFileSync(BITACORA, `${new Date().toISOString()} ${linea}\n`);
}

function esDelSat(host) {
  const limpio = host.toLowerCase().replace(/\.$/u, "");
  return limpio === "sat.gob.mx" || limpio.endsWith(".sat.gob.mx");
}

const lookupReal = dnsPromesas.lookup;
dnsPromesas.lookup = async function lookupSimulado(host, opciones) {
  if (!esDelSat(String(host))) return lookupReal.call(this, host, opciones);
  anotar(`dns ${host} -> ${IP}`);
  const familia = IP.includes(":") ? 6 : 4;
  const todas = typeof opciones === "object" && opciones !== null && opciones.all;
  return todas ? [{ address: IP, family: familia }] : { address: IP, family: familia };
};
syncBuiltinESMExports();

const fetchReal = globalThis.fetch;
globalThis.fetch = async function fetchSimulado(entrada, init) {
  const texto = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
  let url;
  try {
    url = new URL(texto);
  } catch {
    return fetchReal(entrada, init);
  }
  if (!esDelSat(url.hostname)) return fetchReal(entrada, init);
  const pedida = url.toString();
  let respuesta;
  if (pedida === PAGINA) respuesta = new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  else if (pedida === ENLACE) respuesta = new Response(null, { status: 302, headers: { location: "/cifras_sat/Documents/simulado/Listado_Completo_69-B.csv" } });
  else if (pedida === ARCHIVO) respuesta = new Response(CSV, { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } });
  else respuesta = new Response("No existe en el SAT simulado.", { status: 404 });
  anotar(`GET ${pedida} redirect=${init?.redirect ?? "follow"} -> ${respuesta.status}`);
  return respuesta;
};

anotar(`SAT simulado activo; *.sat.gob.mx resuelve a ${IP}`);
