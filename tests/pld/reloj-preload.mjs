// Reloj fijo de PLD para los recorridos. Se carga en `next start` con
// NODE_OPTIONS=--import, solo en el servidor de una prueba local: fuera de ella
// truena (tests/e2e/guarda-preload.mjs). Sin E2E_RELOJ_PLD no hace nada.
//
// Con E2E_RELOJ_PLD=<archivo>, ahoraPld() (src/server/pld/reloj.ts) lee en cada
// llamada la fecha ISO que diga el archivo; vacío o inexistente, la hora real.
// Así el recorrido mueve el «hoy» con que se leen los plazos de PLD entre un
// flujo y otro sin reiniciar el servidor. Las escrituras siguen con now() de la
// base: este reloj solo cambia lo que se lee.
import { readFileSync } from "node:fs";

import { exigirEntornoDePrueba } from "../e2e/guarda-preload.mjs";

exigirEntornoDePrueba("El reloj fijo de PLD");
const archivo = process.env.E2E_RELOJ_PLD;

if (archivo) {
  globalThis.__relojPldE2E = () => {
    let texto = "";
    try {
      texto = readFileSync(archivo, "utf8").trim();
    } catch {
      return new Date();
    }
    if (!texto) return new Date();
    const fijo = new Date(texto);
    if (Number.isNaN(fijo.getTime())) throw new Error(`El reloj fijo de PLD no entiende «${texto.slice(0, 40)}».`);
    return fijo;
  };
}
