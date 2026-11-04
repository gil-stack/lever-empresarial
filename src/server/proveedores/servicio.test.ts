import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import type { AlmacenConstancia } from "./constancia.ts";
import { darDeAltaProveedor } from "./servicio.ts";
import type { ContextoProveedores, RepositorioProveedores } from "./tipos.ts";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const PERSONA = "22222222-2222-4222-8222-222222222222";
const CLABE = "002180701150123452";
const PDF = new Uint8Array(80);
PDF.set([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe("alta de proveedor", () => {
  it("no guarda una CLABE con dígito malo", async () => {
    const libro = memoria();
    await assert.rejects(
      () =>
        darDeAltaProveedor(ctx(["administrador"]), entrada({ clabe: "002180701150123453" }), {
          repositorio: libro,
          almacen: almacen(),
        }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "clabe_invalida",
    );
    assert.equal(libro.altas, 0);
  });

  it("guarda al proveedor del 69-B sin prender el pago, y el contador no da de alta", async () => {
    const libro = memoria();
    libro.situaciones = ["Definitivo"];
    const guardado = await darDeAltaProveedor(ctx(["administrador"]), entrada({}), {
      repositorio: libro,
      almacen: almacen(),
    });
    assert.equal(guardado.decision.botonPago, false);
    assert.match(guardado.mensaje, /pago no/i);
    assert.equal(libro.altas, 1);
    await assert.rejects(
      () => darDeAltaProveedor(ctx(["contador"]), entrada({ rfc: "CABL840215RF4" }), { repositorio: libro, almacen: almacen() }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
  });
});

function entrada(parcial: { clabe?: string; rfc?: string }) {
  return {
    rfc: parcial.rfc ?? "EKU9003173C9",
    razonSocial: "Escuela Kemper",
    clabe: parcial.clabe ?? CLABE,
    constancia: { nombre: "constancia.pdf", bytes: PDF },
  };
}

function ctx(roles: RolCliente[]): ContextoDeTenant {
  return {
    sesionId: "33333333-3333-4333-8333-333333333333",
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

function almacen(): AlmacenConstancia {
  return {
    async guardar(archivo) {
      return { clave: archivo.clave };
    },
    async borrar() {},
  };
}

function memoria(): RepositorioProveedores & { altas: number; situaciones: string[] } {
  const estado = { altas: 0, situaciones: [] as string[] };
  const tx: ContextoProveedores = {
    companyId: EMPRESA,
    consulta: { async query() { return { rows: [], rowCount: 1 }; } },
    async rfcOcupado() {
      return false;
    },
    async leerLista() {
      return { snapshotId: estado.situaciones.length ? "55555555-5555-4555-8555-555555555555" : null, fechaArchivo: "2026-09-30", situaciones: estado.situaciones };
    },
    async insertarDocumento() {},
    async insertarProveedor() {
      estado.altas += 1;
    },
    async insertarClabe() {},
  };
  return {
    get altas() {
      return estado.altas;
    },
    get situaciones() {
      return estado.situaciones;
    },
    set situaciones(valor: string[]) {
      estado.situaciones = valor;
    },
    async conEmpresa(_ctx, fn) {
      return fn(tx);
    },
    async leer() {
      return { lista: null, proveedores: [] };
    },
  };
}
