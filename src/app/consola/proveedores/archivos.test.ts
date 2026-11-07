import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leerArchivoAlta, leerArchivoPago } from "./archivos";

const PDF = new TextEncoder().encode(`%PDF-1.4\n${"x".repeat(80)}\n%%EOF`);

describe("archivos de los formularios de proveedores", () => {
  it("un campo opcional vacío, como lo reconstruye Next, no cuenta como archivo", async () => {
    // Chrome manda filename="" y Next crea File("undefined") de 0 bytes.
    for (const vacio of [new File([], "undefined"), new File([], ""), new File([], "contrato.pdf")]) {
      assert.deepEqual(await leerArchivoAlta(vacio), { meta: null, bytes: null });
      assert.equal(await leerArchivoPago(vacio), null);
    }
  });

  it("un PDF elegido llega con sus bytes y su nombre", async () => {
    const archivo = new File([PDF], "constancia.pdf", { type: "application/pdf" });
    const alta = await leerArchivoAlta(archivo);
    assert.deepEqual(alta.meta, { nombre: "constancia.pdf", tipo: "application/pdf", peso: PDF.byteLength });
    assert.deepEqual(alta.bytes, PDF);
    const pago = await leerArchivoPago(archivo);
    assert.equal(pago?.nombre, "constancia.pdf");
    assert.deepEqual(pago?.bytes, PDF);
  });

  it("lo que no es archivo se ignora y lo que excede 4 MB no se lee", async () => {
    assert.deepEqual(await leerArchivoAlta("texto"), { meta: null, bytes: null });
    assert.equal(await leerArchivoPago(null), null);
    const grande = { name: "grande.pdf", type: "application/pdf", size: 4_000_001, arrayBuffer: () => { throw new Error("no debe leerse"); } };
    assert.deepEqual(await leerArchivoAlta(grande), { meta: { nombre: "grande.pdf", tipo: "application/pdf", peso: 4_000_001 }, bytes: null });
    assert.deepEqual(await leerArchivoPago(grande), { nombre: "grande.pdf", bytes: new Uint8Array() });
  });
});
