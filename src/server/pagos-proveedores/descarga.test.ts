import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encabezadosDescarga } from "./descarga";

describe("descarga de documentos de proveedores", () => {
  it("el XML baja como adjunto opaco y aislado, nunca como documento del origen", () => {
    const encabezados = encabezadosDescarga({ nombre: "factura <A-81>.xml", tipo: "application/xml", peso: 321 });
    assert.equal(encabezados["Content-Type"], "application/octet-stream");
    assert.equal(encabezados["Content-Disposition"], "attachment; filename*=UTF-8''factura%20%3CA-81%3E.xml");
    assert.equal(encabezados["Content-Security-Policy"], "sandbox; default-src 'none'");
    assert.equal(encabezados["X-Content-Type-Options"], "nosniff");
    assert.equal(encabezados["Content-Length"], "321");
    assert.equal(encabezados["Cache-Control"], "private, no-store");
  });

  it("el PDF conserva su tipo pero también baja como adjunto aislado", () => {
    const encabezados = encabezadosDescarga({ nombre: "constancia.pdf", tipo: "application/pdf", peso: 80 });
    assert.equal(encabezados["Content-Type"], "application/pdf");
    assert.match(encabezados["Content-Disposition"] ?? "", /^attachment;/);
    assert.equal(encabezados["Content-Security-Policy"], "sandbox; default-src 'none'");
  });

  it("cualquier otro tipo guardado se sirve opaco", () => {
    assert.equal(encabezadosDescarga({ nombre: "x.html", tipo: "text/html", peso: 1 })["Content-Type"], "application/octet-stream");
  });
});
