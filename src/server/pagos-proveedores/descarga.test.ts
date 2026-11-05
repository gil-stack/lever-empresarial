import assert from "node:assert/strict";
import { describe, it } from "node:test";

import nextConfig from "../../../next.config";

import { encabezadosDescarga, POLITICA_DESCARGA } from "./descarga";

describe("descarga de documentos de proveedores", () => {
  it("el XML baja como adjunto opaco y aislado, nunca como documento del origen", () => {
    const encabezados = encabezadosDescarga({ nombre: "factura <A-81>.xml", tipo: "application/xml", peso: 321 });
    assert.equal(encabezados["Content-Type"], "application/octet-stream");
    assert.equal(encabezados["Content-Disposition"], "attachment; filename*=UTF-8''factura%20%3CA-81%3E.xml");
    assert.equal(encabezados["Content-Security-Policy"], "sandbox; default-src 'none'; frame-ancestors 'none'");
    assert.equal(encabezados["X-Content-Type-Options"], "nosniff");
    assert.equal(encabezados["Content-Length"], "321");
    assert.equal(encabezados["Cache-Control"], "private, no-store");
  });

  it("el PDF conserva su tipo pero también baja como adjunto aislado", () => {
    const encabezados = encabezadosDescarga({ nombre: "constancia.pdf", tipo: "application/pdf", peso: 80 });
    assert.equal(encabezados["Content-Type"], "application/pdf");
    assert.match(encabezados["Content-Disposition"] ?? "", /^attachment;/);
    assert.equal(encabezados["Content-Security-Policy"], "sandbox; default-src 'none'; frame-ancestors 'none'");
  });

  it("cualquier otro tipo guardado se sirve opaco", () => {
    assert.equal(encabezadosDescarga({ nombre: "x.html", tipo: "text/html", peso: 1 })["Content-Type"], "application/octet-stream");
  });
});

describe("encabezados globales de la aplicación", () => {
  it("la regla general no le quita a la descarga su política aislada", async () => {
    // Next aplica las reglas en orden y la última que coincide gana; con la
    // regla general sola, la descarga se quedaba con frame-ancestors y sin sandbox.
    const reglas = (await nextConfig.headers?.()) ?? [];
    const general = reglas.findIndex((regla) => regla.source === "/:path*");
    assert.ok(general >= 0);
    for (const ruta of ["/consola/proveedores/documento/:id", "/c/:empresa/consola/proveedores/documento/:id"]) {
      const indice = reglas.findIndex((regla) => regla.source === ruta);
      assert.ok(indice > general, `${ruta} debe ir después de la regla general`);
      const politica = reglas[indice]?.headers.find((encabezado) => encabezado.key === "Content-Security-Policy")?.value;
      assert.equal(politica, POLITICA_DESCARGA);
    }
    assert.match(POLITICA_DESCARGA, /\bsandbox\b/);
    assert.match(POLITICA_DESCARGA, /frame-ancestors 'none'/);
  });
});
