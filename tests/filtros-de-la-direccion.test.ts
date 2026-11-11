import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const RAIZ = path.resolve(import.meta.dirname, "..");

// Personas y la Lista 69-B tenían su propio filtro de la dirección (`typeof valor === "string"`), aparte del de
// `src/nucleo/direccion.ts`. Una clave repetida (`?q=a&q=b`) llega como lista: el filtro único la descarta igual en
// todas las páginas que lo usan, y un cambio de esa regla no se queda a medias en una copia.
const PAGINAS = ["src/app/consola/personas/page.tsx", "src/app/consola/lista-69b/page.tsx"];

describe("los filtros de la dirección de Personas y de la Lista 69-B pasan por soloTexto", () => {
  for (const pagina of PAGINAS) {
    it(pagina, () => {
      const fuente = readFileSync(path.join(RAIZ, pagina), "utf8");
      assert.match(fuente, /import \{[^}]*\bsoloTexto\b[^}]*\} from "@\/nucleo\/direccion";/, "importa soloTexto");
      assert.match(fuente, /\bsoloTexto\(searchParams\)/, "lee la dirección con soloTexto");
      assert.doesNotMatch(fuente, /typeof [a-zA-Z.]+ === "string"/, "sin un filtro propio en línea");
    });
  }
});
