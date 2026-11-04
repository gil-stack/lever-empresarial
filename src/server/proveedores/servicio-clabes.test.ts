import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { digitoClabe } from "../../dominio/clabe.ts";
import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import { traducirErrorDeBase } from "../session/db.ts";
import type { Rol, Sesion } from "../session/tipos.ts";
import { registrarHechoClabe, type HechoClabe } from "./auditar.ts";
import { SQL } from "./repositorio-clabes.ts";
import {
  asentarClabeProveedor,
  cambiarClabeProveedor,
  leerClabesProveedor,
} from "./servicio-clabes.ts";
import type { FilaClabe, RepositorioClabes } from "./tipos.ts";

const USUARIO = "22222222-2222-4222-8222-222222222222";
const EMPRESA = "7c1e9b2a-6d4f-4a11-8b22-90abcdef1234";
const OTRA = "55555555-5555-4555-8555-555555555555";
const PROVEEDOR = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-11-04T18:40:00.000Z");
const DESPUES = new Date("2026-11-04T20:00:00.000Z");

function armar(diecisiete: string): string {
  const digito = digitoClabe(diecisiete);
  if (digito === null) throw new Error("diecisiete");
  return `${diecisiete}${digito}`;
}

const BANAMEX = armar("00218070115012345");
const FONDOS = armar("64618070115012345");

function sesion(rol: Rol): Sesion {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    venceEn: AHORA,
    usuario: { id: USUARIO, nombre: "Elena Ríos", correo: "elena@ejemplo.mx" },
    companyId: EMPRESA,
    rol,
  };
}

function memoria(rol: Rol) {
  const filas: Array<FilaClabe & { companyId: string }> = [];
  const auditorias: HechoClabe[] = [];
  let listados = 0;
  let empresas = 0;
  const repositorio: RepositorioClabes = {
    async puerta(userId) {
      if (userId !== USUARIO) return null;
      return { rol };
    },
    async listar(userId) {
      listados += 1;
      if (userId !== USUARIO) return [];
      return filas
        .filter((fila) => fila.companyId === EMPRESA)
        .map((fila) => ({
          id: fila.id,
          supplierId: fila.supplierId,
          clabe: fila.clabe,
          desde: fila.desde,
          hasta: fila.hasta,
        }));
    },
    async conEmpresa(userId, fn) {
      empresas += 1;
      if (userId !== USUARIO) throw new ErrorDeDominio("sin_empresa");
      return fn({
        companyId: EMPRESA,
        rol,
        consulta: {
          async query(sql, params) {
            const texto = JSON.stringify(params ?? []);
            assert.equal(texto.includes(BANAMEX), false);
            assert.equal(texto.includes(FONDOS), false);
            assert.match(sql, /insert into audit_events/i);
            return { rows: [], rowCount: 1 };
          },
        },
        async vigente(supplierId) {
          return (
            filas.find(
              (fila) =>
                fila.companyId === EMPRESA && fila.supplierId === supplierId && fila.hasta === null,
            ) ?? null
          );
        },
        async cerrar(id, hasta) {
          const fila = filas.find((item) => item.id === id && item.companyId === EMPRESA && item.hasta === null);
          if (!fila) throw new ErrorDeDominio("proveedor_ausente");
          const digitos = fila.clabe;
          fila.hasta = hasta;
          assert.equal(fila.clabe, digitos);
        },
        async insertar(fila) {
          filas.push({
            id: fila.id,
            supplierId: fila.supplierId,
            clabe: fila.clabe,
            desde: fila.desde,
            hasta: null,
            companyId: EMPRESA,
          });
        },
      });
    },
  };

  return {
    repositorio,
    filas,
    auditorias,
    conteos: () => ({ listados, empresas }),
    deps(ahora = AHORA) {
      return {
        repositorio,
        ahora: () => ahora,
        auditar: async (evento: HechoClabe, consulta: { query: (sql: string, params?: readonly unknown[]) => unknown }) => {
          auditorias.push(evento);
          await registrarHechoClabe(evento, consulta);
        },
      };
    },
  };
}

describe("historial de la CLABE del proveedor", () => {
  it("no guarda un dígito que no cierra", async () => {
    const libro = memoria("administrador");
    await assert.rejects(
      () =>
        asentarClabeProveedor(
          sesion("administrador"),
          { supplierId: PROVEEDOR, clabe: "002180701150123453" },
          libro.deps(),
        ),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "clabe_invalida",
    );
    assert.equal(libro.filas.length, 0);
    assert.equal(libro.conteos().empresas, 0);
  });

  it("cambiar agrega una fila y la anterior sigue con sus 18 dígitos", async () => {
    const libro = memoria("administrador");
    const primera = await asentarClabeProveedor(
      sesion("administrador"),
      { supplierId: PROVEEDOR, clabe: BANAMEX },
      libro.deps(),
    );
    assert.equal(primera.tipo, "asentada");

    const cambio = await cambiarClabeProveedor(
      sesion("administrador"),
      { supplierId: PROVEEDOR, clabe: FONDOS },
      libro.deps(DESPUES),
    );
    assert.equal(cambio.tipo, "cambiada");
    assert.equal(libro.filas.length, 2);

    const anterior = libro.filas.find((fila) => fila.clabe === BANAMEX);
    const vigente = libro.filas.find((fila) => fila.clabe === FONDOS);
    assert.ok(anterior);
    assert.equal(anterior.hasta?.toISOString(), DESPUES.toISOString());
    assert.equal(vigente?.hasta, null);
    assert.equal(libro.auditorias.length, 2);
    assert.equal(JSON.stringify(libro.auditorias).includes(BANAMEX), false);
    assert.equal(JSON.stringify(libro.auditorias).includes(FONDOS), false);
    assert.equal(libro.auditorias[1]?.entidad, "supplier_clabes");
    assert.equal(libro.auditorias[1]?.identificador, vigente?.id);

    const lectura = await leerClabesProveedor(sesion("administrador"), libro.deps());
    assert.equal(lectura.grupos.length, 1);
    assert.equal(lectura.grupos[0]?.vigente?.visible.replace(/\D/g, ""), FONDOS);
    assert.equal(lectura.grupos[0]?.vigente?.institucion.conocida, false);
    if (lectura.grupos[0]?.vigente && !lectura.grupos[0].vigente.institucion.conocida) {
      assert.equal(
        lectura.grupos[0].vigente.institucion.frase,
        "La institución queda pendiente del participante.",
      );
    }
    assert.equal(lectura.grupos[0]?.anteriores.length, 1);
    assert.equal(lectura.grupos[0]?.anteriores[0]?.visible.replace(/\D/g, ""), BANAMEX);
    assert.equal(lectura.grupos[0]?.anteriores[0]?.institucion.conocida, true);
  });

  it("la misma CLABE no agrega otra fila", async () => {
    const libro = memoria("administrador");
    await asentarClabeProveedor(sesion("administrador"), { supplierId: PROVEEDOR, clabe: BANAMEX }, libro.deps());
    const misma = await cambiarClabeProveedor(
      sesion("administrador"),
      { supplierId: PROVEEDOR, clabe: `002 180 70115012345 ${BANAMEX.at(-1)}` },
      libro.deps(DESPUES),
    );
    assert.equal(misma.tipo, "misma");
    assert.equal(libro.filas.length, 1);
    assert.equal(libro.filas[0]?.hasta, null);
    assert.equal(libro.auditorias.length, 1);
  });

  it("el contador ve y no cambia; el tarjetahabiente no ve", async () => {
    const admin = memoria("administrador");
    await asentarClabeProveedor(sesion("administrador"), { supplierId: PROVEEDOR, clabe: BANAMEX }, admin.deps());
    const contador = memoria("contador");
    contador.filas.push(...admin.filas);
    await assert.rejects(
      () => cambiarClabeProveedor(sesion("contador"), { supplierId: PROVEEDOR, clabe: FONDOS }, contador.deps()),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
    const vista = await leerClabesProveedor(sesion("contador"), contador.deps());
    assert.equal(vista.puedeCambiar, false);
    assert.equal(vista.grupos[0]?.vigente?.visible.replace(/\D/g, ""), BANAMEX);

    const telefono = memoria("tarjetahabiente");
    await assert.rejects(
      () => leerClabesProveedor(sesion("tarjetahabiente"), telefono.deps()),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "clabe_no_disponible",
    );
    assert.equal(telefono.conteos().listados, 0);
  });

  it("no lista la CLABE de otra empresa", async () => {
    const libro = memoria("administrador");
    libro.filas.push({
      id: "66666666-6666-4666-8666-666666666666",
      supplierId: PROVEEDOR,
      clabe: FONDOS,
      desde: AHORA,
      hasta: null,
      companyId: OTRA,
    });
    const lectura = await leerClabesProveedor(sesion("administrador"), libro.deps());
    assert.equal(lectura.grupos.length, 0);
  });

  it("la consulta filtra por la empresa de la sesión y no trae el id del navegador", () => {
    assert.match(SQL.listar, /m\.user_id = \$1/);
    assert.match(SQL.listar, /m\.company_id = s\.company_id/);
    assert.equal(SQL.listar.includes("$2"), false);
    assert.match(SQL.insertar, /\$2/);
    assert.match(SQL.vigente, /company_id = \$1/);
    const acciones = readFileSync(new URL("../../app/consola/proveedores/acciones.ts", import.meta.url), "utf8");
    assert.equal(acciones.includes("companyId"), false);
    assert.match(acciones, /revalidatePath\("\/consola\/proveedores"\)/);
    assert.equal(acciones.includes("/telefono"), false);
  });
});

describe("el libro traduce el historial", () => {
  it("el dígito malo, la fila que no se pisa y el borrado tienen código propio", () => {
    assert.equal(
      codigo({ code: "P0001", message: "clabe_no_se_pisa" }),
      "clabe_no_se_pisa",
    );
    assert.equal(
      codigo({ code: "P0001", message: "historial_de_clabe_no_se_borra" }),
      "historial_de_clabe_no_se_borra",
    );
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
