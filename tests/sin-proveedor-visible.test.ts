import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

/**
 * Efevoo es el proveedor interno de los plásticos: su nombre no aparece en ningún texto que vea una persona (pantallas de
 * Operación y del portal, avisos, errores, títulos, correos). Decisión de Gil del 23/11/2026.
 *
 * La prueba lee cada cadena, plantilla y texto JSX de src con el compilador de TypeScript (sin comentarios ni nombres de
 * código) y falla si alguno dice «Efevoo» o «EFEVOO». Los códigos internos van en minúsculas (`efevoo_incierto`) y no cuentan.
 * Solo se libra el cliente del servidor (`src/server/efevoo`), cuyas cadenas son registros, nombres de error y valores de
 * configuración que no llegan a pantalla.
 */

const RAIZ = path.resolve(import.meta.dirname, "..");
const SRC = path.join(RAIZ, "src");
const LIBRES = [path.join(SRC, "server", "efevoo") + path.sep];
const NOMBRE = /Efevoo|EFEVOO/;

function archivos(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = path.join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(ts|tsx)$/.test(ruta) && !/\.test\.tsx?$/.test(ruta) ? [ruta] : [];
  });
}

/** Los textos de un archivo que nombran al proveedor, con su línea. */
export function textosConProveedor(nombreArchivo: string, codigo: string): { linea: number; texto: string }[] {
  const fuente = ts.createSourceFile(nombreArchivo, codigo, ts.ScriptTarget.Latest, true, nombreArchivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hallados: { linea: number; texto: string }[] = [];
  const visitar = (nodo: ts.Node) => {
    let texto: string | null = null;
    if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) texto = nodo.text;
    else if (ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) texto = nodo.text;
    else if (ts.isJsxText(nodo)) texto = nodo.text;
    if (texto !== null && NOMBRE.test(texto)) {
      hallados.push({ linea: fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1, texto: texto.trim().slice(0, 100) });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return hallados;
}

describe("el proveedor de los plásticos no se nombra en pantalla", () => {
  it("detecta cadenas, plantillas y texto JSX, no comentarios ni nombres de código", () => {
    const codigo = [
      "// Efevoo en un comentario",
      "const ErrorEfevoo = 1;",
      "const a = 'efevoo_incierto';",
      "const b = \"Efevoo no respondió\";",
      "const c = `leer ${a} de Efevoo`;",
      "const d = <p>Alta en Efevoo</p>;",
    ].join("\n");
    assert.deepEqual(textosConProveedor("x.tsx", codigo).map((h) => h.linea), [4, 5, 6]);
  });

  it("ningún texto de src dice «Efevoo» fuera del cliente del servidor", () => {
    const hallados = archivos(SRC)
      .filter((ruta) => !LIBRES.some((libre) => ruta.startsWith(libre)))
      .flatMap((ruta) => textosConProveedor(ruta, readFileSync(ruta, "utf8")).map((h) => `${path.relative(RAIZ, ruta)}:${h.linea} ${h.texto}`));
    assert.deepEqual(hallados, [], `Usa «tarjetas» o «el procesador de tarjetas» en lugar del nombre del proveedor:\n${hallados.join("\n")}`);
  });
});
