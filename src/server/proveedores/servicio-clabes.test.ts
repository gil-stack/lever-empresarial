import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { traducirErrorDeBase } from "../../nucleo/db.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { cambiarClabeProveedor } from "./servicio-clabes.ts";
import type { ContextoClabes, FilaClabe, RepositorioClabes } from "./tipos.ts";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const PERSONA = "22222222-2222-4222-8222-222222222222";
const PROVEEDOR = "33333333-3333-4333-8333-333333333333";
const VIGENTE = "002180701150123452";
const NUEVA = "646180701150123452";
// r66-N4: el factor se fecha en cada uso, no al cargar el módulo (como SESION_SOFIPO, tests/operacion/apoyo-alta-regulada.ts):
// 1 s atrás porque factorReciente lee la hora antes que el factor y exige una edad ≥ 0.
const SESION = {
  superficie: "cliente" as const,
  segundoFactor: {
    metodo: "totp" as const,
    get en(): Date {
      return new Date(Date.now() - 1_000);
    },
  },
};

describe("historial de la CLABE del proveedor", () => {
  it("cierra la vigente y deja la anterior", async () => {
    const libro = memoria();
    const resultado = await cambiarClabeProveedor(ctx(["administrador"]), { supplierId: PROVEEDOR, clabe: NUEVA }, SESION, { repositorio: libro, avisar: async () => 0 });
    assert.deepEqual(resultado, { tipo: "cambiada", pagosRegresados: 2, avisosEnviados: 0 }, "informa pagos regresados y que no salió ningún aviso");
    assert.equal(libro.filas.length, 2);
    assert.equal(libro.filas.filter((fila) => fila.hasta === null).length, 1);
    assert.equal(libro.filas[0]?.hasta instanceof Date, true);
  });

  it("la misma CLABE no agrega otra fila y el contador no cambia", async () => {
    const libro = memoria();
    const misma = await cambiarClabeProveedor(ctx(["administrador"]), { supplierId: PROVEEDOR, clabe: VIGENTE }, SESION, { repositorio: libro, avisar: async () => 0 });
    assert.equal(misma.tipo, "misma");
    assert.equal(libro.filas.length, 1);
    await assert.rejects(
      () => cambiarClabeProveedor(ctx(["contador"]), { supplierId: PROVEEDOR, clabe: NUEVA }, SESION, { repositorio: libro, avisar: async () => 0 }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
  });
});

describe("el libro traduce el historial", () => {
  it("el dígito malo, la fila que no se pisa y el borrado tienen código propio", () => {
    assert.equal(codigo({ code: "P0001", message: "clabe_no_se_pisa" }), "clabe_no_se_pisa");
    assert.equal(codigo({ code: "P0001", message: "historial_de_clabe_no_se_borra" }), "historial_de_clabe_no_se_borra");
    assert.equal(
      codigo({ code: "23505", constraint: "supplier_clabes_una_vigente", table: "supplier_clabes" }),
      "clabe_ya_vigente",
    );
    assert.equal(
      codigo({ code: "23514", constraint: "supplier_clabes_clabe_validada", table: "supplier_clabes" }),
      "clabe_invalida",
    );
  });
});

function codigo(error: { code: string; message?: string; constraint?: string; table?: string }): string {
  const traducido = traducirErrorDeBase(error);
  assert.equal(traducido instanceof ErrorDeDominio, true);
  return traducido instanceof ErrorDeDominio ? traducido.codigo : "";
}

function ctx(roles: RolCliente[]): ContextoDeTenant {
  return {
    sesionId: "55555555-5555-4555-8555-555555555555",
    peticionId: null,
    superficie: "cliente",
    persona: { id: PERSONA, nombre: "Ana", correo: "ana@ejemplo.mx" },
    segundoFactor: "totp",
    empresa: {
      id: EMPRESA,
      rfc: "TCM010101AB1",
      razonSocial: "Taller",
      operadorId: "44444444-4444-4444-8444-444444444444",
      estado: "activa",
      demostracion: true,
    },
    roles,
    personal: null,
    empresas: [],
    capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}

function memoria(): RepositorioClabes & { filas: FilaClabe[] } {
  const filas: FilaClabe[] = [
    { id: "66666666-6666-4666-8666-666666666666", supplierId: PROVEEDOR, clabe: VIGENTE, desde: new Date("2026-11-01T00:00:00.000Z"), hasta: null },
  ];
  const tx: ContextoClabes = {
    companyId: EMPRESA,
    consulta: { async query() { return { rows: [], rowCount: 1 }; } },
    async vigente(supplierId) {
      return filas.find((fila) => fila.supplierId === supplierId && fila.hasta === null) ?? null;
    },
    async cerrar(id, hasta) {
      const fila = filas.find((actual) => actual.id === id);
      if (fila) fila.hasta = hasta;
      return { pagosRegresados: 2 };
    },
    async insertar(fila) {
      filas.push({ ...fila, hasta: null });
    },
  };
  return {
    filas,
    async listar() {
      return filas;
    },
    async conEmpresa(_ctx, fn) {
      return fn(tx);
    },
  };
}
