import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { cookieDePreferencia } from "./cookie-preferencia.ts";

function atributos(cookie: string): string[] {
  return cookie.split("; ").slice(1);
}

describe("cookies de preferencia", () => {
  it("por https lleva Secure, SameSite=Lax y Path=/", () => {
    const cookie = cookieDePreferencia("acento", "abc", "https:");
    assert.ok(cookie.startsWith("acento=abc; "));
    assert.deepEqual(atributos(cookie).sort(), ["Max-Age=31536000", "Path=/", "SameSite=Lax", "Secure"]);
  });

  it("por http (localhost) no lleva Secure, para que el navegador la guarde", () => {
    assert.deepEqual(atributos(cookieDePreferencia("tema", "claro", "http:")).sort(), ["Max-Age=31536000", "Path=/", "SameSite=Lax"]);
  });

  it("ninguna escritura de document.cookie en el código del navegador se salta cookieDePreferencia", () => {
    const raiz = path.resolve(import.meta.dirname, "../..");
    const escrituras = archivosEn(raiz).flatMap((archivo) =>
      readFileSync(archivo, "utf8")
        .split("\n")
        .filter((linea) => /document\.cookie\s*=[^=]/.test(linea))
        .map((linea) => `${path.relative(raiz, archivo)}: ${linea.trim()}`),
    );
    assert.ok(escrituras.length >= 2, "tema y acento se escriben desde el navegador");
    assert.deepEqual(escrituras.filter((linea) => !linea.includes("cookieDePreferencia(")), []);
  });
});

function archivosEn(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = path.join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return archivosEn(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !nombre.endsWith(".test.ts") ? [ruta] : [];
  });
}
