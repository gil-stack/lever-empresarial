import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import { config } from "../../src/proxy.ts";

const PUBLICO = new URL("../../public/", import.meta.url);

function archivosDe(carpeta: URL, prefijo = ""): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = new URL(nombre, carpeta);
    return statSync(ruta).isDirectory() ? archivosDe(new URL(`${nombre}/`, carpeta), `${prefijo}${nombre}/`) : [`${prefijo}${nombre}`];
  });
}

// El matcher de Next es una expresión regular sobre la ruta completa.
const pasaPorElProxy = (ruta: string) => config.matcher.some((patron) => new RegExp(`^${patron}$`).test(ruta));

describe("archivos de public/ fuera del proxy", () => {
  it("ningún archivo de public/ pasa por el proxy (el proxy los reescribiría a 404)", () => {
    const archivos = archivosDe(PUBLICO);
    assert.ok(archivos.includes("lever-email.png"), "El logo de los correos vive en public/");
    const atrapados = archivos.filter((archivo) => pasaPorElProxy(`/${archivo}`));
    assert.deepEqual(atrapados, [], `Agrega por nombre exacto al matcher de src/proxy.ts: ${atrapados.join(", ")}`);
  });

  it("las rutas de la app, incluidas las que llevan punto, siguen pasando por el proxy", () => {
    for (const ruta of ["/", "/consola", "/c/33333333-3333-4333-8333-333333333333/consola", "/entrar", "/operacion", "/consola/archivo.png", "/lever-email.png/x", "/icon.svg.bak"]) {
      assert.equal(pasaPorElProxy(ruta), true, ruta);
    }
    for (const ruta of ["/icon.svg", "/lever-email.png", "/_next/static/chunk.js", "/_next/image"]) {
      assert.equal(pasaPorElProxy(ruta), false, ruta);
    }
  });

  it("lo que solo se parece a _next o a un archivo que no existe pasa por el proxy: su 404 lleva la política con nonce", () => {
    for (const ruta of ["/favicon.ico", "/_nextfoo", "/__nextfoo", "/_next-algo/consola", "/__next/consola", "/_next/staticfoo", "/_next/imagenes", "/_next/x"]) {
      assert.equal(pasaPorElProxy(ruta), true, ruta);
    }
  });
});
