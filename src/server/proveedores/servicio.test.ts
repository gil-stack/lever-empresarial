import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { digitoClabe } from "../../dominio/clabe.ts";
import { decisionGuardada } from "../../dominio/proveedores.ts";
import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import type { Rol, Sesion } from "../session/tipos.ts";
import { SQL } from "./repositorio.ts";
import { darDeAltaProveedor, guardarListado69b, leerProveedores } from "./servicio.ts";
import type { ClabeNueva, DocumentoNuevo, ProveedorNuevo, RepositorioProveedores, SnapshotNuevo } from "./tipos.ts";

const AHORA = new Date("2026-11-04T18:30:00.000Z");
const CLABE = "002180701150123452";
const RFC = "EKU9003173C9";
const LISTADO = `"Información actualizada al 30 de septiembre de 2026; listado público.",
No,RFC,Nombre del Contribuyente,Situación del contribuyente
1,AAA080808HL8,ASESORES,Sentencia Favorable
`;

describe("alta de proveedor", () => {
  it("no guarda una CLABE con dígito malo ni un PDF que no lo es", async () => {
    const mundo = memoria();
    const admin = mundo.sembrar("administrador");
    await assert.rejects(
      () => darDeAlta(mundo, admin, { clabe: "002180701150123453" }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "clabe_invalida",
    );
    await assert.rejects(
      () => darDeAlta(mundo, admin, { bytes: png() }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "constancia_tipo",
    );
    await assert.rejects(
      () => darDeAlta(mundo, admin, { rfc: "Amazon", razonSocial: "Amazon México" }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "rfc_longitud",
    );
    assert.equal(mundo.proveedores.length, 0);
    assert.equal(mundo.guardados.length, 0);
  });

  it("rechaza el RFC repetido aunque cambie la razón social, y no sube otra constancia", async () => {
    const mundo = memoria();
    const admin = mundo.sembrar("administrador");
    const primero = await darDeAlta(mundo, admin, { razonSocial: "Escuela Kemper Urgate" });
    assert.equal(primero.decision.botonPago, false);
    assert.match(primero.mensaje, /no hay botón de pago/);
    assert.equal(mundo.guardados.length, 1);
    assert.equal(mundo.guardados[0]?.startsWith("http"), false);

    await assert.rejects(
      () => darDeAlta(mundo, admin, { razonSocial: "Amazon México", rfc: "eku 900317 3c9" }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "proveedor_duplicado",
    );
    assert.equal(mundo.proveedores.length, 1);
    assert.equal(mundo.guardados.length, 1);
    assert.equal(mundo.proveedores[0]?.razonSocial, "Escuela Kemper Urgate");
  });

  it("guarda al proveedor que está en el 69-B y no le prende el botón de pago", async () => {
    const mundo = memoria();
    const admin = mundo.sembrar("administrador");
    const cargado = await guardarListado69b(LISTADO, mundo.deps);
    assert.equal(cargado.fechaArchivo, "2026-09-30");

    const guardado = await darDeAlta(mundo, admin, { rfc: "AAA080808HL8", razonSocial: "Asesores en avalúos" });
    assert.equal(guardado.decision.botonPago, false);
    assert.equal(guardado.decision.motivo, "en_lista");
    assert.equal(guardado.decision.situacion, "Sentencia Favorable");
    assert.match(guardado.mensaje, /no hay botón de pago/);

    const lectura = await leerProveedores(sesion(admin, "administrador"), mundo.deps);
    assert.equal(lectura.lista?.fechaArchivo, "2026-09-30");
    assert.equal(lectura.proveedores[0]?.decision.botonPago, false);
    assert.equal(lectura.proveedores[0]?.clabe, CLABE);
    assert.equal(mundo.auditoria.some((evento) => JSON.stringify(evento).includes(CLABE)), false);
    assert.equal(mundo.auditoria[0]?.accion, "alta_proveedor");
    assert.equal(mundo.auditoria[0]?.entidad, "suppliers");
    assert.equal(mundo.auditoria[1]?.accion, "clabe_proveedor");
    assert.equal(mundo.auditoria[1]?.entidad, "supplier_clabes");
  });

  it("con archivo y RFC fuera de la lista el dato permite pago, y la pantalla sigue sin enviarlo", async () => {
    const mundo = memoria();
    const admin = mundo.sembrar("administrador");
    await guardarListado69b(LISTADO, mundo.deps);
    const guardado = await darDeAlta(mundo, admin, {});
    assert.equal(guardado.decision.botonPago, true);
    assert.equal(guardado.decision.motivo, "fuera_de_lista");
    assert.match(guardado.mensaje, /no envía el pago/);
    assert.doesNotMatch(guardado.mensaje, /no hay botón de pago/);
  });

  it("el contador ve y no da de alta; el tarjetahabiente no entra; otra empresa no se ve", async () => {
    const mundo = memoria();
    const empresa = randomUUID();
    const admin = mundo.sembrar("administrador", empresa);
    const contador = mundo.sembrar("contador", empresa);
    const tarjeta = mundo.sembrar("tarjetahabiente", empresa);
    const otra = mundo.sembrar("administrador");
    await darDeAlta(mundo, admin, {});

    const vista = await leerProveedores(sesion(contador, "contador"), mundo.deps);
    assert.equal(vista.proveedores.length, 1);
    await assert.rejects(
      () => darDeAlta(mundo, contador, { rfc: "AAA010101AAA" }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
    );
    await assert.rejects(
      () => leerProveedores(sesion(tarjeta, "tarjetahabiente"), mundo.deps),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "proveedores_no_disponibles",
    );

    const ajena = await leerProveedores(sesion(otra, "administrador"), mundo.deps);
    assert.equal(ajena.proveedores.length, 0);
    const repetidoEnOtra = await darDeAlta(mundo, otra, {});
    assert.equal(repetidoEnOtra.decision.motivo, "sin_archivo");
    assert.equal(mundo.proveedores.length, 2);
  });

  it("las migraciones no crean un pago y no pierden las tablas", () => {
    const proveedores = readFileSync(new URL("../../../db/migrations/0012_proveedores.sql", import.meta.url), "utf8");
    const lista = readFileSync(new URL("../../../db/migrations/0013_lista_69b.sql", import.meta.url), "utf8");
    const clabes = readFileSync(new URL("../../../db/migrations/0014_clabes_proveedor.sql", import.meta.url), "utf8");
    assert.match(proveedores, /create table documents/i);
    assert.match(proveedores, /create table suppliers/i);
    assert.match(proveedores, /suppliers_pago_solo_fuera_de_lista/);
    assert.match(proveedores, /suppliers_rfc_por_empresa/);
    assert.match(proveedores, /clave_blob !~\* '\^https\?:/);
    assert.doesNotMatch(proveedores, /create table\s+supplier_clabes/i);
    assert.doesNotMatch(proveedores, /create table\s+lista_69b/i);
    assert.match(lista, /create table lista_69b_snapshots/i);
    assert.match(lista, /create table lista_69b_rows/i);
    assert.match(clabes, /create table supplier_clabes/i);
    assert.match(clabes, /clabe_digito_371\(clabe\)/);
    assert.match(clabes, /clabe_no_se_pisa/);
    assert.doesNotMatch(`${proveedores}\n${lista}\n${clabes}`, /create table\s+(spei_transfers|payment_orders|payroll)/i);
    assert.match(SQL.proveedores, /s\.company_id = \$1/);
    assert.match(SQL.insertarClabe, /company_id/);
    assert.doesNotMatch(SQL.proveedores, /clave_blob|hash_sha256/);
    assert.equal(digitoClabe("00218070115012345"), 2);
  });
});

function pdf(): Uint8Array {
  const bytes = new Uint8Array(80);
  bytes.set(Buffer.from("%PDF-1.4\n"));
  return bytes;
}

function png(): Uint8Array {
  const bytes = new Uint8Array(80);
  bytes.set(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return bytes;
}

function sesion(userId: string, rol: Rol): Sesion {
  return {
    id: randomUUID(),
    venceEn: AHORA,
    usuario: { id: userId, nombre: "Ada", correo: "ada@ejemplo.mx" },
    companyId: null,
    rol,
  };
}

async function darDeAlta(
  mundo: ReturnType<typeof memoria>,
  userId: string,
  parcial: { rfc?: string; razonSocial?: string; clabe?: string; bytes?: Uint8Array },
) {
  const rol = mundo.usuarios.get(userId)?.rol ?? "administrador";
  return darDeAltaProveedor(
    sesion(userId, rol),
    {
      rfc: parcial.rfc ?? RFC,
      razonSocial: parcial.razonSocial ?? "Escuela Kemper Urgate",
      clabe: parcial.clabe ?? CLABE,
      constancia: { nombre: "constancia.pdf", bytes: parcial.bytes ?? pdf() },
    },
    mundo.deps,
  );
}

function memoria() {
  const usuarios = new Map<string, { companyId: string; rol: Rol }>();
  const proveedores: {
    companyId: string;
    id: string;
    rfc: string;
    razonSocial: string;
    clabe: string;
    constancia: string;
    hash: string;
    clave: string;
    decision: ReturnType<typeof decisionGuardada>;
    leidaEn: string;
  }[] = [];
  const auditoria: { accion: string; entidad: string; identificador: string }[] = [];
  const snapshots: SnapshotNuevo[] = [];
  const guardados: string[] = [];
  const borrados: string[] = [];

  const repositorio: RepositorioProveedores = {
    async conEmpresa(userId, fn) {
      const usuario = usuarios.get(userId);
      if (!usuario) throw new ErrorDeDominio("sin_empresa");
      let documento: DocumentoNuevo | null = null;
      let proveedor: ProveedorNuevo | null = null;
      let clabe: ClabeNueva | null = null;
      const resultado = await fn({
        companyId: usuario.companyId,
        rol: usuario.rol,
        consulta: {
          async query() {
            return { rows: [], rowCount: 0 };
          },
        },
        async rfcOcupado(rfc) {
          return proveedores.some((fila) => fila.companyId === usuario.companyId && fila.rfc === rfc);
        },
        async leerLista(rfc) {
          const ultimo = snapshots.at(-1);
          if (!ultimo) return { snapshotId: null, fechaArchivo: null, situaciones: [] };
          return {
            snapshotId: ultimo.id,
            fechaArchivo: ultimo.fechaArchivo,
            situaciones: ultimo.filas.filter((fila) => fila.rfc === rfc).map((fila) => fila.situacion),
          };
        },
        async insertarDocumento(nuevo) {
          documento = nuevo;
        },
        async insertarProveedor(nuevo) {
          proveedor = nuevo;
        },
        async insertarClabe(nueva) {
          clabe = nueva;
        },
      });
      if (documento && proveedor && clabe) {
        const doc = documento as DocumentoNuevo;
        const alta = proveedor as ProveedorNuevo;
        const cuenta = clabe as ClabeNueva;
        proveedores.push({
          companyId: usuario.companyId,
          id: alta.id,
          rfc: alta.rfc,
          razonSocial: alta.razonSocial,
          clabe: cuenta.clabe,
          constancia: doc.nombre,
          hash: doc.hash,
          clave: doc.clave,
          decision: decisionGuardada({ situacion: alta.situacion, fechaArchivo: alta.fechaArchivo }),
          leidaEn: alta.leidaEn.toISOString(),
        });
        assert.match(doc.hash, /^[0-9a-f]{64}$/);
        assert.equal(/^https?:\/\//i.test(doc.clave), false);
      }
      return resultado;
    },
    async leer(userId) {
      const usuario = usuarios.get(userId);
      if (!usuario) return null;
      const ultimo = snapshots.at(-1);
      return {
        rol: usuario.rol,
        lista: ultimo ? { fechaArchivo: ultimo.fechaArchivo, cargadoEn: ultimo.cargadoEn.toISOString() } : null,
        proveedores: proveedores
          .filter((fila) => fila.companyId === usuario.companyId)
          .map((fila) => ({
            id: fila.id,
            rfc: fila.rfc,
            razonSocial: fila.razonSocial,
            clabe: fila.clabe,
            constancia: fila.constancia,
            decision: fila.decision,
            leidaEn: fila.leidaEn,
          })),
      };
    },
    async guardarSnapshot(snapshot) {
      snapshots.push(snapshot);
    },
  };

  return {
    usuarios,
    proveedores,
    auditoria,
    guardados,
    borrados,
    sembrar(rol: Rol, companyId?: string) {
      const userId = randomUUID();
      usuarios.set(userId, { companyId: companyId ?? randomUUID(), rol });
      return userId;
    },
    deps: {
      repositorio,
      ahora: () => AHORA,
      almacen: {
        async guardar(entrada: { clave: string }) {
          guardados.push(entrada.clave);
          return { clave: entrada.clave };
        },
        async borrar(clave: string) {
          borrados.push(clave);
        },
      },
      auditar: async (evento: { accion: string; entidad: string; identificador: string }) => {
        auditoria.push({ accion: evento.accion, entidad: evento.entidad, identificador: evento.identificador });
      },
    },
  };
}
