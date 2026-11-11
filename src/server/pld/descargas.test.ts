import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import nextConfig from "../../../next.config";
import { POLITICA_DESCARGA } from "../pagos-proveedores/descarga";

/** Las rutas de archivo (route.ts) de PLD que hay en el portal, como las escribe Next sin el grupo «(portal)». */
function rutasDeArchivo(): string[] {
  const raiz = join(process.cwd(), "src/app/operacion/(portal)");
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (nombre === "route.ts") salida.push(dir.slice(raiz.length).replace(/\[(\w+)\]/g, ":$1"));
    }
  };
  for (const zona of ["pld", "comite", "reportes", "conservacion"]) recorrer(join(raiz, zona));
  return salida.map((ruta) => `/operacion${ruta}`).sort();
}

describe("descargas de PLD", () => {
  it("r2-serv-N8: cada descarga de PLD conserva su política aislada frente a la regla general", async () => {
    const rutas = rutasDeArchivo();
    assert.equal(rutas.length, 6, rutas.join(", "));
    const reglas = (await nextConfig.headers?.()) ?? [];
    const general = reglas.findIndex((regla) => regla.source === "/:path*");
    assert.ok(general >= 0);
    for (const ruta of rutas) {
      const indice = reglas.findIndex((regla) => regla.source === ruta);
      assert.ok(indice > general, `${ruta} va después de la regla general`);
      const politica = reglas[indice]?.headers.find((encabezado) => encabezado.key === "Content-Security-Policy")?.value;
      assert.equal(politica, POLITICA_DESCARGA, ruta);
    }
    assert.match(POLITICA_DESCARGA, /\bsandbox\b/);
  });
});
