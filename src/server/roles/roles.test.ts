import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { capacidadesDe, type RolCliente } from "../../nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { CONTRATO_TABLAS, SQL } from "./contrato.ts";
import { empresaOperable, rolesPueden } from "./decidir.ts";
import { cambiarAccesoFinanzas } from "./finanzas.ts";
import { asignarRol, entrarAPoliza, liberarLoteDePrueba, quitarRol, solicitarLoteDePrueba } from "./servicio.ts";
import type { FilaDeLote, Membresia, RepositorioRoles } from "./tipos.ts";

const HORA = new Date("2026-11-03T18:00:00.000Z");
const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LUIS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROSA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EMPRESA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");

describe("membresías con varios roles", () => {
  it("el liberador suelta dinero y el administrador solo no", () => {
    assert.equal(rolesPueden(["liberador"], "cliente.pago.liberar"), true);
    assert.equal(rolesPueden(["administrador"], "cliente.pago.liberar"), false);
    assert.equal(rolesPueden(["administrador", "liberador"], "cliente.pago.liberar"), true);
    assert.equal(rolesPueden(["contador"], "cliente.poliza.ver"), true);
    assert.equal(rolesPueden(["contador"], "cliente.pago.liberar"), false);
  });

  it("agrega un rol a quien ya es miembro y no deja la empresa sin administrador", async () => {
    const repo = memoria();
    repo.sembrar(ANA, ["administrador", "contador"]);
    repo.sembrar(LUIS, ["solicitante"]);
    await asignarRol(ctx(ANA, ["administrador"]), { userId: LUIS, rol: "liberador" }, { repositorio: repo });
    const luis = await repo.membresiaDe(ctx(ANA, ["administrador"]), LUIS);
    assert.deepEqual(luis?.roles.sort(), ["liberador", "solicitante"]);
    assert.equal(
      await codigo(quitarRol(ctx(ANA, ["administrador"]), { userId: ANA, rol: "administrador" }, { repositorio: repo })),
      "ultimo_administrador",
    );
    assert.equal(
      await codigo(asignarRol(ctx(ANA, ["administrador"]), { userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", rol: "contador" }, { repositorio: repo })),
      "sin_membresia",
    );
  });

  it("nadie queda solo con Finanzas: es un acceso adicional, no un rol de trabajo", async () => {
    const repo = memoria();
    repo.sembrar(ANA, ["administrador"]);
    repo.sembrar(LUIS, ["contador", "finanzas"]);
    assert.equal(
      await codigo(quitarRol(ctx(ANA, ["administrador"]), { userId: LUIS, rol: "contador" }, { repositorio: repo })),
      "ultimo_rol_de_trabajo",
    );
    assert.deepEqual((await repo.membresiaDe(ctx(ANA, ["administrador"]), LUIS))?.roles, ["contador", "finanzas"]);
    await quitarRol(ctx(ANA, ["administrador"]), { userId: LUIS, rol: "finanzas" }, { repositorio: repo });
    assert.deepEqual((await repo.membresiaDe(ctx(ANA, ["administrador"]), LUIS))?.roles, ["contador"]);
  });

  it("la casilla de Finanzas solo la cambia administración, en su empresa, y regresa a su valor si falla", async () => {
    const repo = memoria();
    repo.sembrar(ANA, ["administrador"]);
    repo.sembrar(LUIS, ["tarjetahabiente"]);
    repo.sembrar(ROSA, ["finanzas"]);
    const admin = ctx(ANA, ["administrador"]);

    const otorgado = await cambiarAccesoFinanzas(admin, { userId: LUIS, verFinanzas: "si" }, { repositorio: repo });
    assert.deepEqual(otorgado, { tipo: "listo", mensaje: "La persona ya puede ver Inicio financiero.", habilitado: true });
    assert.deepEqual((await repo.membresiaDe(admin, LUIS))?.roles, ["tarjetahabiente", "finanzas"]);

    // Un contador (o la propia persona con Finanzas) no se da ni se quita el acceso.
    const sinPermiso = await cambiarAccesoFinanzas(ctx(LUIS, ["tarjetahabiente", "finanzas"]), { userId: LUIS, verFinanzas: "no" }, { repositorio: repo });
    assert.deepEqual(sinPermiso, { tipo: "rechazado", codigo: "sin_permiso", habilitado: true });
    assert.deepEqual((await repo.membresiaDe(admin, LUIS))?.roles, ["tarjetahabiente", "finanzas"]);

    // Una persona de otra empresa no está en este repositorio: el userId ajeno no elige empresa.
    const ajena = await cambiarAccesoFinanzas(admin, { userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", verFinanzas: "si" }, { repositorio: repo });
    assert.deepEqual(ajena, { tipo: "rechazado", codigo: "sin_membresia", habilitado: false });

    assert.deepEqual(
      await cambiarAccesoFinanzas(admin, { userId: "no-es-uuid", verFinanzas: "si" }, { repositorio: repo }),
      { tipo: "rechazado", codigo: "identificador_invalido", habilitado: false },
    );
    assert.deepEqual(
      await cambiarAccesoFinanzas(admin, { userId: LUIS, verFinanzas: "quizas" }, { repositorio: repo }),
      { tipo: "rechazado", codigo: "identificador_invalido", habilitado: false },
    );
    assert.deepEqual(
      await cambiarAccesoFinanzas(admin, { userId: ROSA, verFinanzas: "no" }, { repositorio: repo }),
      { tipo: "rechazado", codigo: "ultimo_rol", habilitado: true },
    );
    assert.deepEqual(
      await cambiarAccesoFinanzas(null, { userId: LUIS, verFinanzas: "no" }, { repositorio: repo }),
      { tipo: "rechazado", codigo: "sesion", habilitado: true },
    );

    const carrera = memoria();
    carrera.sembrar(LUIS, ["contador"]);
    carrera.agregarRol = async () => {
      throw new ErrorDeDominio("rol_existente");
    };
    assert.deepEqual(
      await cambiarAccesoFinanzas(admin, { userId: LUIS, verFinanzas: "si" }, { repositorio: carrera }),
      { tipo: "rechazado", codigo: "rol_existente", habilitado: true },
    );

    const caida = memoria();
    caida.sembrar(LUIS, ["contador", "finanzas"]);
    caida.membresiaDe = async () => {
      throw new ErrorDeDominio("base_no_disponible");
    };
    assert.deepEqual(
      await cambiarAccesoFinanzas(admin, { userId: LUIS, verFinanzas: "no" }, { repositorio: caida }),
      { tipo: "rechazado", codigo: "libro", habilitado: true },
    );
  });

  it("dos liberadores firman y el administrador sin ese rol no", async () => {
    const repo = memoria();
    repo.sembrar(ANA, ["administrador"]);
    repo.sembrar(LUIS, ["liberador"]);
    repo.sembrar(ROSA, ["liberador"]);
    const solicitud = await solicitarLoteDePrueba(ctx(LUIS, ["liberador"]), {}, { repositorio: repo, ahora: () => HORA });
    assert.equal(
      await codigo(liberarLoteDePrueba(ctx(ANA, ["administrador"]), { loteId: solicitud.id }, { repositorio: repo })),
      "sin_permiso_para_liberar",
    );
    const cerrada = await liberarLoteDePrueba(ctx(ROSA, ["liberador"]), { loteId: solicitud.id }, { repositorio: repo, ahora: () => HORA });
    assert.equal(cerrada.liberadorId, ROSA);
    assert.notEqual(cerrada.liberadorId, cerrada.solicitanteId);
    assert.equal(empresaOperable(await repo.membresiasDeLaEmpresa(ctx(ANA, ["administrador"]))), true);
  });

  it("la póliza abre en lectura para contador y administrador", async () => {
    assert.equal((await entrarAPoliza(ctx(ROSA, ["contador"]))).accion, "exportar_poliza");
    assert.equal((await entrarAPoliza(ctx(ANA, ["administrador"]))).accion, "exportar_poliza");
    assert.equal(await codigo(entrarAPoliza(ctx(LUIS, ["liberador"]))), "sin_entrada_a_poliza");
  });
});

function ctx(userId: string, roles: RolCliente[]): ContextoDeTenant {
  return {
    sesionId: "66666666-6666-4666-8666-666666666666",
    peticionId: null,
    superficie: "cliente",
    persona: { id: userId, nombre: "Ana", correo: "ana@ejemplo.mx" },
    segundoFactor: "totp",
    empresa: {
      id: EMPRESA,
      rfc: "EKU9003173C9",
      razonSocial: "Escuela",
      operadorId: "77777777-7777-4777-8777-777777777777",
      estado: "activa",
      demostracion: true,
    },
    roles,
    personal: null,
    empresas: [{ id: EMPRESA, razonSocial: "Escuela" }],
    capacidades: capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }),
  };
}

function memoria(): RepositorioRoles & { sembrar: (userId: string, roles: RolCliente[]) => void; lotes: FilaDeLote[] } {
  const miembros = new Map<string, Membresia>();
  const lotes: FilaDeLote[] = [];
  return {
    lotes,
    sembrar(userId, roles) {
      miembros.set(userId, { userId, companyId: EMPRESA, roles: [...roles] });
    },
    async membresiaDe(_ctx, userId) {
      const encontrada = miembros.get(userId.toLowerCase()) ?? miembros.get(userId);
      return encontrada ? { ...encontrada, roles: [...encontrada.roles] } : null;
    },
    async membresiasDeLaEmpresa() {
      return [...miembros.values()].map((miembro) => ({ ...miembro, roles: [...miembro.roles] }));
    },
    async agregarRol(_ctx, cambio) {
      const miembro = miembros.get(cambio.userId);
      if (!miembro) throw new ErrorDeDominio("sin_membresia");
      if (miembro.roles.includes(cambio.rol)) throw new ErrorDeDominio("rol_existente");
      miembro.roles.push(cambio.rol);
    },
    async quitarRol(_ctx, cambio) {
      const miembro = miembros.get(cambio.userId);
      if (!miembro || !miembro.roles.includes(cambio.rol)) throw new ErrorDeDominio("sin_membresia");
      miembro.roles = miembro.roles.filter((rol) => rol !== cambio.rol);
    },
    async insertarSolicitud(_ctx, solicitud) {
      lotes.push(solicitud);
    },
    async leerLote(_ctx, id) {
      return lotes.find((fila) => fila.id === id) ?? null;
    },
    async cerrarLiberacion(_ctx, lote) {
      const indice = lotes.findIndex((fila) => fila.id === lote.id);
      if (indice < 0 || lotes[indice]?.liberadorId) throw new ErrorDeDominio("lote_ya_firmado");
      lotes[indice] = lote;
    },
  };
}

function cuerpoDeTabla(sql: string, tabla: string): string {
  const marca = new RegExp(`create table ${tabla}\\s*\\(`, "i").exec(sql);
  if (!marca) throw new Error(`No está la tabla ${tabla}`);
  const inicio = marca.index + marca[0].length;
  const fin = sql.indexOf(");", inicio);
  if (fin < 0) throw new Error(`La tabla ${tabla} no cierra`);
  return sql.slice(inicio, fin);
}

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
  throw new Error("la operación no rechazó");
}

describe("contrato de tablas", () => {
  it("el check de uuid vive en la migración, sin columnas de dinero", () => {
    const sql = readFileSync(path.join(RAIZ, "db/migrations/0011_firmas_plazo_baja.sql"), "utf8");
    assert.match(sql, /solicitante_user_id <> liberador_user_id/);
    assert.match(sql, /CONSTRAINT lotes_prueba_es_prueba CHECK \(es_prueba\)/);
    assert.match(sql, /autorizados < 2/);
    assert.match(sql, /membresia\.rol = 'liberador'/);
    assert.equal(sql.includes("rol IN ('administrador', 'liberador')"), false);
    assert.match(sql, /employee_id/);
    assert.match(sql, /employees_quita_liberador/);
    assert.match(sql, /employees_exige_auditoria_de_baja_en_alta/);
    for (const codigoFirma of [
      "misma_persona_en_las_dos_firmas",
      "dinero_real_fuera",
      "firma_en_un_solo_acto",
      "firmante_ajeno",
      "contador_no_libera",
      "sin_permiso_para_liberar",
      "empresa_no_operable",
      "contador_no_crea_pago",
      "sin_permiso_para_solicitar",
    ]) {
      assert.equal(sql.includes(codigoFirma), true, codigoFirma);
    }

    const cuerpo = cuerpoDeTabla(sql, "lotes_prueba");
    assert.equal((cuerpo.match(/references users/gi) ?? []).length, 2);
    assert.equal((cuerpo.match(/references companies/gi) ?? []).length, 1);
    for (const palabra of ["monto", "centavo", "clabe", "spei", "enviado", "liquidado", "costo"]) {
      assert.equal(cuerpo.toLowerCase().includes(palabra), false, palabra);
    }
    for (const columna of [
      "company_id",
      "solicitante_user_id",
      "liberador_user_id",
      "solicitado_en",
      "liberado_en",
      "es_prueba",
    ]) {
      assert.equal(cuerpo.includes(columna), true, columna);
    }

    assert.match(SQL.insertarSolicitud, /values \(\$1, \$2, \$3, \$4, true\)/);
    assert.equal(SQL.insertarSolicitud.toLowerCase().includes("liberador"), false);
    assert.match(CONTRATO_TABLAS, /0011_firmas_plazo_baja/);
    assert.match(CONTRATO_TABLAS, /no se ejecuta/i);

    const directorio = path.join(RAIZ, "db/migrations");
    const archivos = readdirSync(directorio);
    assert.equal(archivos.includes("0011_firmas_plazo_baja.sql"), true);
    const servicio = readFileSync(path.join(AQUI, "servicio.ts"), "utf8");
    assert.equal(servicio.includes("...entrada"), false);
    assert.equal(servicio.includes("firmarLoteDePrueba"), false);
    const migrador = readFileSync(path.join(RAIZ, "db/migrate.sh"), "utf8");
    assert.equal(migrador.includes("contrato.sql"), false);
    assert.match(migrador, /Prefijo repetido/);
  });
});
