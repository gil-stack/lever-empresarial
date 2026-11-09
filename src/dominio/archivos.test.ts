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
import { MAXIMO_RENGLONES_LPB } from "./operacion/lpb.ts";
import { CONSTANCIA_Y_CONTRATO, CONTRATO_DEMASIADO_GRANDE, PESO_MAXIMO_CONSTANCIA, XML_Y_PDF } from "./proveedores.ts";

describe("tope de archivos", () => {
  it("cabe con margen en el límite del cuerpo, que es el mismo de Vercel (4.5 MB)", () => {
    const limite = nextConfig.experimental?.serverActions?.bodySizeLimit;
    assert.equal(limite, "4.5mb");
    assert.equal(TOPE_ARCHIVO_BYTES, 4 * 1024 * 1024);
    // 512 KiB bajo el límite de Next para los demás campos y la envoltura multipart.
    assert.ok(bytes.parse(String(limite))! - TOPE_ARCHIVO_BYTES >= 512 * 1024);
    // Aun si los 4.5 MB de Vercel fueran decimales, quedan más de 256 KiB.
    assert.ok(4_500_000 - TOPE_ARCHIVO_BYTES > 256 * 1024);
    assert.equal(PESO_MAXIMO_CONSTANCIA, TOPE_ARCHIVO_BYTES);
  });

  it("una lista de 50 000 renglones con nombre, RFC, CURP, tipo y fecha cabe en el tope", () => {
    const renglon = "MARIA FERNANDA LOPEZ HERNANDEZ,LOHM800101AB1,LOHM800101MDFPRR09,fisica,2026-11-01\n";
    const csv = "nombre,rfc,curp,tipo,fecha\n" + renglon.repeat(MAXIMO_RENGLONES_LPB);
    assert.equal(MAXIMO_RENGLONES_LPB, 50_000);
    assert.ok(Buffer.byteLength(csv) > 4_000_000, "con el tope anterior no cabía");
    assert.ok(Buffer.byteLength(csv) <= TOPE_ARCHIVO_BYTES);
  });

  it("la etiqueta, los avisos y los textos de proveedores citan la misma cifra", () => {
    assert.equal(TOPE_ARCHIVO_TEXTO, `${TOPE_ARCHIVO_BYTES / (1024 * 1024)} MB`);
    for (const texto of [ARCHIVO_DEMASIADO_GRANDE, LISTA_DEMASIADO_GRANDE, CONSTANCIA_Y_CONTRATO, XML_Y_PDF, CONTRATO_DEMASIADO_GRANDE]) {
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

  // Décima revisión: con el error del archivo que devolvió el servidor, el control marcado recibe también el foco.
  it("el error del servidor marca el campo de archivo, lo liga al aviso y le da el foco", () => {
    const ligado = { "aria-invalid": true, "aria-describedby": "aviso-operacion", autoFocus: true };
    const html = renderToStaticMarkup(createElement(CampoArchivo, { id: "doc-archivo", name: "archivo", accept: ".pdf", mensaje: ARCHIVO_DEMASIADO_GRANDE, ligado }));
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /aria-describedby="aviso-operacion"/);
    assert.match(html, /autofocus=""/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(CampoArchivo, { id: "doc-archivo", name: "archivo", accept: ".pdf", mensaje: ARCHIVO_DEMASIADO_GRANDE })), /autofocus/);
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
