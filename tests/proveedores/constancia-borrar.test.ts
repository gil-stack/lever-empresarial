import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { test } from "node:test";

import { almacenVercel, TOPE_BORRADO_MS } from "../../src/server/proveedores/constancia.ts";

const relojes = () => process.getActiveResourcesInfo().filter((recurso) => recurso === "Timeout").length;

const REGISTRO_DEL_TOPE = {
  nivel: "error",
  origen: "blob.borrar",
  evento: "huerfano_sin_borrar",
  clave: "constancias/huerfana.pdf",
  causa: "tiempo_agotado",
  tope_ms: TOPE_BORRADO_MS,
  error: "Error",
};

/** Un Blob de mentiras: contesta con `responder`, no contesta (null) o no escucha (conexión rechazada). */
async function blob(responder: ((respuesta: ServerResponse) => void) | null | "rechaza") {
  let peticiones = 0;
  const servidor = createServer((_peticion, respuesta) => {
    peticiones++;
    if (typeof responder === "function") responder(respuesta);
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", () => listo()));
  const { port } = servidor.address() as { port: number };
  if (responder === "rechaza") await new Promise<void>((listo) => servidor.close(() => listo()));
  process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${port}/api/blob`;
  process.env.BLOB_READ_WRITE_TOKEN = ["vercel", "blob", "rw", "e2elocal", "emulador"].join("_");
  return {
    peticiones: () => peticiones,
    cerrar: () => {
      servidor.closeAllConnections();
      servidor.close();
    },
  };
}

// serv-N16: borrar el huérfano no deja colgada la petición más del tope, conteste Blob o no. @vercel/blob
// reintenta la conexión rechazada y el 503 con espera creciente; antes, la acción tardaba de 6 a 11 s.
for (const [caso, responder, registro] of [
  ["Blob contesta 200", (respuesta: ServerResponse) => respuesta.writeHead(200, { "content-type": "application/json" }).end("{}"), []],
  ["Blob no contesta", null, [REGISTRO_DEL_TOPE]],
  ["Blob rechaza la conexión", "rechaza", [REGISTRO_DEL_TOPE]],
  [
    "Blob contesta 503",
    (respuesta: ServerResponse) =>
      respuesta.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "service_unavailable", message: "caído" } })),
    [REGISTRO_DEL_TOPE],
  ],
] as const) {
  test(`borrar el huérfano: ${caso}, vuelve dentro del tope, deja su registro y ningún reloj colgado`, async () => {
    const servidor = await blob(responder);
    const salida: string[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => salida.push(partes.map(String).join(" "));
    const base = relojes();
    const inicio = Date.now();
    try {
      await almacenVercel().borrar("constancias/huerfana.pdf");
    } finally {
      console.error = original;
    }
    const tardo = Date.now() - inicio;
    const peticionesAlVolver = servidor.peticiones();
    try {
      assert.ok(tardo <= TOPE_BORRADO_MS + 250, `tardó ${tardo} ms`);
      assert.deepEqual(salida.map((renglon) => JSON.parse(renglon)), registro);
      // El reloj del tope se limpia; la espera que la biblioteca tuviera pendiente (a lo más 8 s) termina
      // sola y, con la señal ya abortada, no manda otra petición.
      const hasta = Date.now() + 9000;
      while (relojes() > base && Date.now() < hasta) await new Promise((listo) => setTimeout(listo, 100));
      assert.equal(relojes(), base, "quedó un reloj colgado");
      assert.equal(servidor.peticiones(), peticionesAlVolver, "salió otra petición después del tope");
    } finally {
      servidor.cerrar();
    }
  });
}
