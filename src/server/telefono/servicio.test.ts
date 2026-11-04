import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { contenidoDeDatosFiscales, qrDeDatosFiscales } from "./datos.ts";
import { SQL_TELEFONO } from "./repositorio.ts";
import { leerFacturacionTelefono, leerInicioTelefono, leerTopesTelefono } from "./servicio.ts";
import type { DatosFiscalesTelefono, RepositorioTelefono } from "./tipos.ts";

const fiscales: DatosFiscalesTelefono = { rfc: "EKU9003173C9", razonSocial: "Escuela Kemper", codigoPostal: "06600", regimen: "601", uso: "G03" };

describe("proyección mínima del teléfono", () => {
  it("el tarjetahabiente lee topes NULL y cero sin consultar la política completa", async () => {
    const repo = memoria();
    assert.equal(await leerInicioTelefono(ctx(["tarjetahabiente"]), { repositorio: repo }), null);
    const topes = await leerTopesTelefono(ctx(["tarjetahabiente"]), { repositorio: repo });
    assert.deepEqual(topes.map((tope) => tope.topeCentavos), [null, 0]);
    const fuente = `${readFileSync(new URL("./servicio.ts", import.meta.url), "utf8")}\n${readFileSync(new URL("./repositorio.ts", import.meta.url), "utf8")}`;
    assert.doesNotMatch(fuente, /leerPolitica|postings|drawers|password_hash|\bclabe\b/i);
    assert.doesNotMatch(SQL_TELEFONO.inicio, /join|clabe/i);
  });

  it("sin empresa o sin rol no abre la proyección", async () => {
    await assert.rejects(() => leerTopesTelefono(null, { repositorio: memoria() }), (error: unknown) => error instanceof ErrorDeDominio);
    await assert.rejects(() => leerFacturacionTelefono(ctx([]), { repositorio: memoria() }), (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso");
  });

  it("el QR contiene los mismos datos visibles y no afirma validez documental", async () => {
    const contenido = contenidoDeDatosFiscales(fiscales);
    const objeto = JSON.parse(contenido) as Record<string, unknown>;
    assert.equal(objeto.rfc, fiscales.rfc);
    assert.equal(objeto.razonSocial, fiscales.razonSocial);
    assert.equal(objeto.codigoPostal, fiscales.codigoPostal);
    assert.equal(objeto.regimen, fiscales.regimen);
    assert.equal(objeto.uso, fiscales.uso);
    assert.doesNotMatch(contenido, /timbre|cfdi/i);
    assert.match(await qrDeDatosFiscales(fiscales), /^data:image\/png;base64,/);
    assert.deepEqual(await leerFacturacionTelefono(ctx(["tarjetahabiente"]), { repositorio: memoria() }), fiscales);
  });
});

function memoria(): RepositorioTelefono {
  return {
    async inicio() { return null; },
    async topes() { return [
      { id: "11111111-1111-4111-8111-111111111111", nombre: "Sin escribir", topeCentavos: null },
      { id: "22222222-2222-4222-8222-222222222222", nombre: "Cero", topeCentavos: 0 },
    ]; },
    async facturacion() { return fiscales; },
  };
}

function ctx(roles: RolCliente[]): ContextoDeTenant {
  const id = "11111111-1111-4111-8111-111111111111";
  return {
    sesionId: "33333333-3333-4333-8333-333333333333",
    peticionId: null,
    superficie: "telefono",
    persona: { id: "44444444-4444-4444-8444-444444444444", nombre: "Ada", correo: "ada@ejemplo.mx" },
    segundoFactor: "totp",
    empresa: { id, rfc: fiscales.rfc, razonSocial: fiscales.razonSocial, operadorId: "55555555-5555-4555-8555-555555555555", estado: "activa", demostracion: true },
    roles,
    personal: null,
    empresas: [{ id, razonSocial: fiscales.razonSocial, roles }],
    capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}
