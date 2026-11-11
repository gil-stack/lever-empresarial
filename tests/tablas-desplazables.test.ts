import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const RAIZ = path.resolve(import.meta.dirname, "..");

function archivosEn(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = path.join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return archivosEn(ruta);
    return ruta.endsWith(".tsx") ? [ruta] : [];
  });
}

describe("las tablas que se desplazan a lo ancho se alcanzan con el teclado (axe scrollable-region-focusable)", () => {
  it("cada .tabla-contenedor del portal, de Operación y del muestrario es una región con nombre y tabIndex", () => {
    const contenedores = archivosEn(path.join(RAIZ, "src")).flatMap((archivo) =>
      [...readFileSync(archivo, "utf8").matchAll(/<div className="tabla-contenedor"[^>]*>/g)].map((m) => ({ archivo: path.relative(RAIZ, archivo), etiqueta: m[0] })),
    );
    // Sin la regla, a 390 (o con más columnas) la tabla desborda y quien usa el teclado no puede recorrerla.
    assert.ok(contenedores.length >= 23, `${contenedores.length} contenedores`);
    const sinRegion = contenedores.filter(({ etiqueta }) => !/tabIndex=\{0\}/.test(etiqueta) || !/role="region"/.test(etiqueta) || !/aria-label="Tabla de[^"]+"/.test(etiqueta));
    assert.deepEqual(sinRegion, []);
    const nombres = contenedores.map(({ etiqueta }) => /aria-label="([^"]+)"/.exec(etiqueta)?.[1]);
    assert.equal(new Set(nombres).size, nombres.length, "cada región con su propio nombre");
  });
});
