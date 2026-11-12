import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, ROLES_CLIENTE } from "../../nucleo/capacidades.ts";
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

  it("una empresa suspendida conserva los roles y solo las capacidades de consulta en consola y teléfono", async () => {
    for (const rol of ROLES_CLIENTE) {
      for (const superficie of ["cliente", "telefono"] as const) {
        for (const empresaPedida of [ID, null]) {
          const resuelto = await resolverContexto(
            { sesion: sesion(), empresaPedida, peticionId: null, superficie },
            { repositorio: { async pertenencia() { return { membresias: [{ ...membresia(ID, [rol]), estado: "suspendida" }], personal: null }; } } },
          );
          assert.equal(resuelto.ctx.empresa?.estado, "suspendida");
          assert.deepEqual(resuelto.ctx.roles, [rol]);
          assert.deepEqual(resuelto.ctx.empresas[0]?.roles, [rol]);
          assert.deepEqual(resuelto.ctx.capacidades, capacidadesDe({ rolesCliente: [rol], rolesPlataforma: [] }).filter((capacidad) => capacidad.endsWith(".ver")));
        }
      }
    }
  });

  it("activar una empresa devuelve sus capacidades y los demás estados no dan permisos", async () => {
    for (const estado of ["activa", "prospecto", "en_alta", "baja", "desconocido"]) {
      const resuelto = await resolverContexto(
        { sesion: sesion(), empresaPedida: ID, peticionId: null, superficie: "cliente" },
        { repositorio: { async pertenencia() { return { membresias: [{ ...membresia(ID, ["administrador", "liberador"]), estado }], personal: null }; } } },
      );
      const roles = estado === "activa" ? ["administrador", "liberador"] as const : [];
      assert.deepEqual(resuelto.ctx.roles, roles);
      assert.deepEqual(resuelto.ctx.capacidades, capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }));
    }
  });
});

describe("el personal actúa como plataforma solo con la sesión SOFIPO", () => {
  const personal = {
    async pertenencia() {
      return { membresias: [{ ...membresia(ID, ["administrador"]), estado: "suspendida" }], personal: { operadorId: "55555555-5555-4555-8555-555555555555", roles: ["administracion_plataforma" as const] } };
    },
  };

  it("entrar por /entrar no le da capacidades plataforma.* (69-B, precio) ni lo marca como personal", async () => {
    for (const superficie of ["cliente", undefined] as const) {
      const resuelto = await resolverContexto(
        { sesion: { ...sesion(), ...(superficie ? { superficie } : {}) }, empresaPedida: null, peticionId: null, superficie: "cliente" },
        { repositorio: personal },
      );
      assert.equal(resuelto.ctx.personal, null);
      assert.equal(resuelto.ctx.capacidades.some((capacidad) => capacidad.startsWith("plataforma.")), false);
      assert.equal(resuelto.ctx.empresa, null);
    }
  });

  it("con la sesión de la puerta SOFIPO conserva sus capacidades, aun en una ruta cliente", async () => {
    const resuelto = await resolverContexto(
      { sesion: { ...sesion(), superficie: "sofipo" }, empresaPedida: null, peticionId: null, superficie: "cliente" },
      { repositorio: personal },
    );
    assert.equal(resuelto.ctx.personal?.operadorId, "55555555-5555-4555-8555-555555555555");
    assert.equal(resuelto.ctx.capacidades.includes("plataforma.precio.publicar"), true);
    assert.equal(resuelto.ctx.capacidades.includes("plataforma.lista69b.cargar"), true);
  });
});

function membresia(id: string, roles: MembresiaLeida["roles"]): MembresiaLeida {
  return { id, rfc: "EKU9003173C9", razonSocial: `Empresa ${id.slice(0, 1)}`, operadorId: "55555555-5555-4555-8555-555555555555", estado: "activa", demostracion: true, roles };
}

function sesion(): Sesion {
  return { id: "33333333-3333-4333-8333-333333333333", venceEn: new Date("2026-11-05T00:00:00Z"), usuario: { id: "44444444-4444-4444-8444-444444444444", nombre: "Ada", correo: "ada@ejemplo.mx" }, segundoFactor: { metodo: "totp", en: new Date("2026-11-04T00:00:00Z") } };
}
