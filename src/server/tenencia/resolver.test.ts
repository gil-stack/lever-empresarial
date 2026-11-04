import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Sesion } from "../session/tipos.ts";
import { resolverContexto, type MembresiaLeida } from "./resolver.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";

describe("destino multiempresa con tenencia intacta", () => {
  it("conserva roles por empresa sin mezclarlos en el contexto pendiente", async () => {
    const resuelto = await resolverContexto(
      { sesion: sesion(), empresaPedida: null, peticionId: null, superficie: "cliente" },
      { repositorio: { async pertenencia() { return { membresias: [membresia(ID, ["administrador"]), membresia(OTRA, ["tarjetahabiente"])], personal: null }; } } },
    );
    assert.equal(resuelto.eleccion, "pendiente");
    assert.equal(resuelto.ctx.empresa, null);
    assert.deepEqual(resuelto.ctx.empresas.map((empresa) => empresa.roles), [["administrador"], ["tarjetahabiente"]]);
    assert.deepEqual(resuelto.ctx.capacidades, []);
  });

  it("una empresa ajena no recibe roles ni empresa", async () => {
    const resuelto = await resolverContexto(
      { sesion: sesion(), empresaPedida: OTRA, peticionId: null, superficie: "telefono" },
      { repositorio: { async pertenencia() { return { membresias: [membresia(ID, ["tarjetahabiente"])], personal: null }; } } },
    );
    assert.equal(resuelto.eleccion, "ajena");
    assert.equal(resuelto.ctx.empresa, null);
    assert.deepEqual(resuelto.ctx.capacidades, []);
  });
});

function membresia(id: string, roles: MembresiaLeida["roles"]): MembresiaLeida {
  return { id, rfc: "EKU9003173C9", razonSocial: `Empresa ${id.slice(0, 1)}`, operadorId: "55555555-5555-4555-8555-555555555555", estado: "activa", demostracion: true, roles };
}

function sesion(): Sesion {
  return { id: "33333333-3333-4333-8333-333333333333", venceEn: new Date("2026-11-05T00:00:00Z"), usuario: { id: "44444444-4444-4444-8444-444444444444", nombre: "Ada", correo: "ada@ejemplo.mx" }, segundoFactor: { metodo: "totp", en: new Date("2026-11-04T00:00:00Z") } };
}
