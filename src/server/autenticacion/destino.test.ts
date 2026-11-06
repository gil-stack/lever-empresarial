import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RolCliente } from "../../nucleo/capacidades.ts";
import { destinoDeMembresia, destinoDespuesDeEntrar, destinoSeguro, rutaDeDestino } from "./destino.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const empresa = (id: string, roles: RolCliente[]) => ({ id, razonSocial: "Empresa", roles });

describe("destino posterior al segundo factor", () => {
  it("manda al tarjetahabiente al teléfono aunque pida consola", () => {
    assert.equal(destinoDespuesDeEntrar([empresa(ID, ["tarjetahabiente"])], "/consola"), `/c/${ID}/telefono`);
  });

  it("conserva ambas superficies para el rol combinado", () => {
    const combinada = empresa(ID, ["administrador", "tarjetahabiente"]);
    assert.equal(destinoDeMembresia(combinada), `/c/${ID}/consola`);
    assert.equal(destinoDeMembresia(combinada, "/telefono"), `/c/${ID}/telefono`);
  });

  it("manda a quien no tiene Finanzas directamente a Pendientes", () => {
    assert.equal(destinoDeMembresia(empresa(ID, ["contador"])), `/c/${ID}/consola/pendientes`);
    assert.equal(destinoDeMembresia(empresa(ID, ["contador", "finanzas"])), `/c/${ID}/consola`);
  });

  it("resuelve varias empresas con el selector y no con un rol mezclado", () => {
    const empresas = [empresa(ID, ["administrador"]), empresa(OTRA, ["tarjetahabiente"])];
    assert.equal(destinoDespuesDeEntrar(empresas, "/telefono"), "/empresas");
    assert.equal(destinoDespuesDeEntrar([], "/consola"), "/empresas");
  });

  it("no acepta una URL externa y siempre pasa por el resolvedor", () => {
    assert.equal(destinoSeguro("https://ejemplo.invalid"), "/consola");
    assert.equal(rutaDeDestino("/telefono"), "/entrar/destino?siguiente=%2Ftelefono");
  });
});
