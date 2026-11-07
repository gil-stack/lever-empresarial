import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { almacenVercel, TOPE_BORRADO_MS } from "../../src/server/proveedores/constancia.ts";

// serv-N16: si Blob no contesta, borrar el huérfano no deja colgada la petición (antes, más
// de 90 s sin un renglón en el registro). Se rinde al tope y deja su clave para borrarla a mano.
test("el borrado del huérfano se rinde al tope cuando Blob no contesta y lo deja en el registro", async () => {
  const servidor = createServer(() => {
    // Nunca contesta.
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", () => listo()));
  const { port } = servidor.address() as { port: number };
  process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${port}/api/blob`;
  process.env.BLOB_READ_WRITE_TOKEN = ["vercel", "blob", "rw", "e2elocal", "emulador"].join("_");
  const registro: string[] = [];
  const original = console.error;
  console.error = (...partes: unknown[]) => registro.push(partes.map(String).join(" "));
  const inicio = Date.now();
  try {
    await Promise.race([
      almacenVercel().borrar("constancias/huerfana.pdf"),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("el borrado sigue colgado")), TOPE_BORRADO_MS + 10_000).unref()),
    ]);
  } finally {
    console.error = original;
    servidor.closeAllConnections();
    servidor.close();
  }
  assert.ok(Date.now() - inicio < TOPE_BORRADO_MS + 3000, `tardó ${Date.now() - inicio} ms`);
  assert.equal(registro.length, 1);
  assert.deepEqual(JSON.parse(registro[0] ?? "{}"), {
    nivel: "error",
    origen: "blob.borrar",
    evento: "huerfano_sin_borrar",
    clave: "constancias/huerfana.pdf",
    causa: "tiempo_agotado",
    tope_ms: TOPE_BORRADO_MS,
    error: "Error",
  });
});
