import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import bytes from "next/dist/compiled/bytes";

import nextConfig from "../../next.config.ts";
import { ARCHIVO_DEMASIADO_GRANDE, LISTA_DEMASIADO_GRANDE } from "../components/operacion/aviso.tsx";
import { CampoArchivo } from "../components/operacion/campo-archivo.tsx";
import { POLITICA_DESCARGA } from "../server/pagos-proveedores/descarga.ts";
import { TOPE_ARCHIVO_BYTES, TOPE_ARCHIVO_TEXTO } from "./archivos.ts";
import { CONSTANCIA_Y_CONTRATO, PESO_MAXIMO_CONSTANCIA, XML_Y_PDF } from "./proveedores.ts";

describe("tope de archivos", () => {
  it("cabe con margen en el límite del cuerpo, que es el mismo de Vercel (4.5 MB)", () => {
    const limite = nextConfig.experimental?.serverActions?.bodySizeLimit;
    assert.equal(limite, "4.5mb");
    assert.ok(TOPE_ARCHIVO_BYTES <= 4_000_000);
    assert.ok(TOPE_ARCHIVO_BYTES < bytes.parse(String(limite))!);
    assert.equal(PESO_MAXIMO_CONSTANCIA, TOPE_ARCHIVO_BYTES);
  });

  it("la etiqueta, los avisos y los textos de proveedores citan la misma cifra", () => {
    assert.equal(TOPE_ARCHIVO_TEXTO, `${TOPE_ARCHIVO_BYTES / 1_000_000} MB`);
    for (const texto of [ARCHIVO_DEMASIADO_GRANDE, LISTA_DEMASIADO_GRANDE, CONSTANCIA_Y_CONTRATO, XML_Y_PDF]) {
      assert.ok(texto.includes(TOPE_ARCHIVO_TEXTO), texto);
    }
    const expediente = readFileSync(new URL("../components/operacion/expediente.tsx", import.meta.url), "utf8");
    assert.match(expediente, /hasta \{TOPE_ARCHIVO_TEXTO\}/);
  });

  it("el campo de archivo no muestra aviso hasta que el navegador mide un archivo grande", () => {
    const html = renderToStaticMarkup(createElement(CampoArchivo, { id: "doc-archivo", name: "archivo", accept: ".pdf", mensaje: ARCHIVO_DEMASIADO_GRANDE }));
    assert.match(html, /type="file"/);
    assert.doesNotMatch(html, /role="alert"/);
  });
});

describe("política de descarga", () => {
  it("la descarga del expediente gana la política aislada sobre la regla general", async () => {
    const reglas = await nextConfig.headers!();
    const fuente = (source: string) => reglas.findIndex((regla) => regla.source === source);
    const general = fuente("/:path*");
    for (const source of ["/operacion/clientes/:id/expediente/documento/:documentoId", "/consola/proveedores/documento/:id"]) {
      const indice = fuente(source);
      assert.ok(indice > general, source);
      assert.deepEqual(reglas[indice]!.headers, [{ key: "Content-Security-Policy", value: POLITICA_DESCARGA }]);
    }
    assert.match(POLITICA_DESCARGA, /^sandbox;/);
  });
});
