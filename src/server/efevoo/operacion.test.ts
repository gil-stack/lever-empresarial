import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import {
  asignarTarjetaEnEfevoo,
  cancelarTarjetaEnEfevoo,
  darDeAltaEnEfevoo,
  depositarDineroDePrueba,
  leerSeccionEfevoo,
  validarTitular,
  type EntradaAsignacion,
} from "./operacion";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const personal = (roles: string[]) =>
  ({ persona: { id: "22222222-2222-4222-8222-222222222222" }, personal: { operadorId: "33333333-3333-4333-8333-333333333333", roles }, peticionId: null, superficie: "sofipo", capacidades: [] }) as unknown as ContextoDePersonal;

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ErrorDeDominio, String(e));
    return e.codigo;
  }
  assert.fail("debía fallar");
}

const TITULAR: EntradaAsignacion = {
  companyId: EMPRESA, llave: "44444444-4444-4444-8444-444444444444", llaveActivacion: "55555555-5555-4555-8555-555555555555",
  employeeId: "66666666-6666-4666-8666-666666666666", inventarioId: "557", ultimos8: "40001363",
  nombre: "Paula", primerApellido: "Ceiba", segundoApellido: "", nombreEmbozar: "PAULA CEIBA",
  telefono: "5500000001", correo: "paula@lever.test", paisNacimiento: "México", domicilio: "Calle Prueba 1",
};

describe("Efevoo en Operación: quién puede", () => {
  it("alguien de la plataforma con otro rol no lee ni opera la sección (ni llega a la base ni a Efevoo)", async () => {
    for (const roles of [["cumplimiento"], ["originacion"], ["aprobacion", "auditoria"], []]) {
      const ctx = personal(roles);
      assert.equal(await codigo(leerSeccionEfevoo(ctx, EMPRESA, { config: null })), "sin_permiso_operacion", roles.join(","));
      assert.equal(await codigo(darDeAltaEnEfevoo(ctx, { companyId: EMPRESA, llave: TITULAR.llave }, { config: null })), "sin_permiso_operacion");
      assert.equal(await codigo(depositarDineroDePrueba(ctx, { companyId: EMPRESA, llave: TITULAR.llave, monto: "10" }, { config: null })), "sin_permiso_operacion");
      assert.equal(await codigo(asignarTarjetaEnEfevoo(ctx, TITULAR, { config: null })), "sin_permiso_operacion");
      assert.equal(await codigo(cancelarTarjetaEnEfevoo(ctx, { companyId: EMPRESA, llave: TITULAR.llave, tarjetaId: TITULAR.employeeId, motivo: "x".repeat(20), confirmacion: "1363" }, { config: null })), "sin_permiso_operacion");
    }
  });

  it("sin configuración de Efevoo, el alta y el depósito lo dicen por su nombre", async () => {
    const admin = personal(["administracion_plataforma"]);
    assert.equal(await codigo(darDeAltaEnEfevoo(admin, { companyId: EMPRESA, llave: TITULAR.llave }, { config: null })), "efevoo_no_configurado");
    assert.equal(await codigo(depositarDineroDePrueba(admin, { companyId: EMPRESA, llave: TITULAR.llave, monto: "10" }, { config: null })), "efevoo_no_configurado");
  });

  it("el depósito de prueba no existe en producción", async () => {
    const admin = personal(["administracion_plataforma"]);
    const produccion = { url: "https://efevoo.prueba/v1/apiservice", usuario: "u", llave: "llave-larga-1", ambiente: "produccion" as const };
    assert.equal(await codigo(depositarDineroDePrueba(admin, { companyId: EMPRESA, llave: TITULAR.llave, monto: "10" }, { config: produccion, efevoo: {} as never })), "solo_sandbox");
  });
});

describe("Efevoo en Operación: los datos del titular", () => {
  it("valida cada campo con su propio código", () => {
    const casos: [Partial<EntradaAsignacion>, string][] = [
      [{ correo: "paula@gmail.com" }, "correo_de_prueba"],
      [{ correo: "no-es-correo" }, "dato_invalido_correo"],
      [{ telefono: "55 0000 0001" }, "dato_invalido_telefono"],
      [{ ultimos8: "1363" }, "dato_invalido_ultimos8"],
      [{ nombre: "" }, "dato_invalido_nombre"],
      [{ primerApellido: "C3iba" }, "dato_invalido_primerApellido"],
      [{ nombreEmbozar: "Paula Ceiba" }, "dato_invalido_nombreEmbozar"],
      [{ nombreEmbozar: "P" }, "dato_invalido_nombreEmbozar"],
      [{ paisNacimiento: "" }, "dato_invalido_paisNacimiento"],
      [{ domicilio: "abc" }, "dato_invalido_domicilio"],
      [{ nombre: "Paula​" }, "dato_invalido_nombre"],
    ];
    for (const [cambio, esperado] of casos) {
      assert.throws(() => validarTitular({ ...TITULAR, ...cambio }, "sandbox"), (e: unknown) => e instanceof ErrorDeDominio && e.codigo === esperado, JSON.stringify(cambio));
    }
  });

  it("en producción un correo real sí vale; el segundo apellido puede ir vacío", () => {
    const { titular, ultimos8 } = validarTitular({ ...TITULAR, correo: "Paula@Empresa.MX" }, "produccion");
    assert.equal(titular.correo, "paula@empresa.mx");
    assert.equal(titular.segundoApellido, "");
    assert.equal(ultimos8, "40001363");
  });
});
