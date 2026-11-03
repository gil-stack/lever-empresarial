import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import { ROLES, type Rol, type Sesion } from "../session/tipos.ts";
import { CONTRATO_TABLAS, SQL } from "./contrato.ts";
import {
  FIRMAS_DE_NOMINA,
  QUIEN_LIBERA,
  ROLES_ASIGNABLES,
  accionesDe,
  empresaOperable,
  loteNoGuardable,
  puedeEntrarAPoliza,
  puedeSoltarDinero,
} from "./decidir.ts";
import { asignarMembresia, cambiarRol, entrarAPoliza, firmarLoteDePrueba } from "./servicio.ts";
import type { LoteDePrueba, Membresia, RepositorioRoles } from "./tipos.ts";

const ANA = "11111111-1111-4111-8111-111111111111";
const LUIS = "22222222-2222-4222-8222-222222222222";
const CARMEN = "33333333-3333-4333-8333-333333333333";
const PEDRO = "44444444-4444-4444-8444-444444444444";
const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HORA = new Date("2026-11-03T18:00:00.000Z");
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");

describe("membresías de la fase 2", () => {
  it("el contador entra a la póliza y no suelta dinero", () => {
    assert.deepEqual(accionesDe("contador"), ["exportar_poliza"]);
    assert.equal(puedeEntrarAPoliza("contador"), true);
    assert.equal(puedeSoltarDinero("contador"), false);
    assert.equal(puedeSoltarDinero("administrador"), true);
    assert.equal(puedeSoltarDinero(QUIEN_LIBERA), true);
    assert.equal(puedeSoltarDinero("solicitante"), false);
    assert.equal(puedeSoltarDinero("tarjetahabiente"), false);
    assert.equal(puedeEntrarAPoliza("liberador"), false);
    assert.deepEqual([...ROLES_ASIGNABLES], ["administrador", "liberador", "contador"]);
    for (const rol of ROLES_ASIGNABLES) assert.equal(ROLES.includes(rol), true);
  });

  it("asigna administrador, quien libera y contador dentro de la empresa de quien administra", async () => {
    const repo = memoria();
    repo.sembrarUsuario(ANA);
    repo.sembrarUsuario(LUIS);
    repo.sembrarUsuario(CARMEN);
    repo.sembrarMembresia({ userId: ANA, companyId: EMPRESA_A, rol: "administrador" });

    const liberador = await asignarMembresia(
      sesion(ANA, "contador", EMPRESA_B),
      { userId: LUIS, rol: QUIEN_LIBERA, companyId: EMPRESA_B },
      { repositorio: repo },
    );
    const contador = await asignarMembresia(
      sesion(ANA),
      { userId: CARMEN, rol: "contador", companyId: EMPRESA_B },
      { repositorio: repo },
    );

    assert.deepEqual(liberador, { userId: LUIS, companyId: EMPRESA_A, rol: "liberador" });
    assert.equal(contador.companyId, EMPRESA_A);
    assert.equal(contador.rol, "contador");
    assert.equal(repo.lotes.length, 0);
  });

  it("no asigna los otros roles ni una segunda empresa", async () => {
    const repo = memoria();
    repo.sembrarUsuario(ANA);
    repo.sembrarUsuario(LUIS);
    repo.sembrarUsuario(CARMEN);
    repo.sembrarMembresia({ userId: ANA, companyId: EMPRESA_A, rol: "administrador" });
    repo.sembrarMembresia({ userId: CARMEN, companyId: EMPRESA_B, rol: "administrador" });

    assert.equal(
      await codigo(asignarMembresia(sesion(ANA), { userId: LUIS, rol: "solicitante" }, { repositorio: repo })),
      "rol_no_asignable",
    );
    assert.equal(
      await codigo(asignarMembresia(sesion(ANA), { userId: LUIS, rol: "quien libera" }, { repositorio: repo })),
      "rol_no_asignable",
    );
    assert.equal(
      await codigo(asignarMembresia(sesion(ANA), { userId: LUIS, rol: "tarjetahabiente" }, { repositorio: repo })),
      "rol_no_asignable",
    );
    assert.equal(
      await codigo(asignarMembresia(sesion(ANA), { userId: PEDRO, rol: "contador" }, { repositorio: repo })),
      "usuario_ausente",
    );
    await asignarMembresia(sesion(ANA), { userId: LUIS, rol: "liberador" }, { repositorio: repo });
    assert.equal(
      await codigo(asignarMembresia(sesion(ANA), { userId: LUIS, rol: "contador" }, { repositorio: repo })),
      "membresia_existente",
    );
    assert.equal(
      await codigo(asignarMembresia(sesion(CARMEN), { userId: LUIS, rol: "liberador" }, { repositorio: repo })),
      "segunda_razon_social",
    );
    assert.equal(
      await codigo(asignarMembresia(sesion(LUIS), { userId: ANA, rol: "contador" }, { repositorio: repo })),
      "sin_permiso",
    );
  });

  it("no deja la cuenta sin administrador y el rol guardado gana al de la sesión", async () => {
    const repo = memoria();
    repo.sembrarUsuario(ANA);
    repo.sembrarUsuario(LUIS);
    repo.sembrarMembresia({ userId: ANA, companyId: EMPRESA_A, rol: "administrador" });
    assert.equal(
      await codigo(cambiarRol(sesion(ANA), { userId: ANA, rol: "liberador", companyId: EMPRESA_B }, { repositorio: repo })),
      "ultimo_administrador",
    );

    repo.sembrarMembresia({ userId: LUIS, companyId: EMPRESA_A, rol: "liberador" });
    await cambiarRol(sesion(ANA, "contador"), { userId: LUIS, rol: "administrador" }, { repositorio: repo });
    const ana = await cambiarRol(sesion(ANA), { userId: ANA, rol: "liberador" }, { repositorio: repo });
    assert.equal(ana.rol, "liberador");
    assert.equal(ana.companyId, EMPRESA_A);

    await cambiarRol(sesion(LUIS), { userId: ANA, rol: "contador" }, { repositorio: repo });
    assert.equal(
      await codigo(asignarMembresia(sesion(ANA, "administrador"), { userId: LUIS, rol: "contador" }, { repositorio: repo })),
      "sin_permiso",
    );
  });
});

describe("la entrada a la póliza", () => {
  it("el contador exporta y quien libera no entra por esa puerta", async () => {
    const repo = libroOperable();
    const entrada = await entrarAPoliza(sesion(CARMEN, "liberador"), { repositorio: repo });
    assert.deepEqual(entrada, { accion: "exportar_poliza", companyId: EMPRESA_A });
    assert.equal(JSON.stringify(entrada).includes("soltar"), false);
    assert.equal(await codigo(entrarAPoliza(sesion(LUIS), { repositorio: repo })), "sin_entrada_a_poliza");
    const delAdministrador = await entrarAPoliza(sesion(ANA), { repositorio: repo });
    assert.equal(delAdministrador.accion, "exportar_poliza");
  });
});

describe("lote de prueba con dos firmas", () => {
  it("el mismo usuario no ocupa las dos firmas", async () => {
    const repo = libroOperable();
    const deps = { repositorio: repo, ahora: () => HORA, id: () => PEDRO };
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(LUIS), { solicitanteId: LUIS, liberadorId: LUIS }, deps),
      ),
      "misma_persona_en_las_dos_firmas",
    );
    assert.equal(repo.lotes.length, 0);
    assert.equal(
      loteNoGuardable({ solicitanteId: LUIS, liberadorId: LUIS, esPrueba: true }),
      "misma_persona_en_las_dos_firmas",
    );

    const lote = await firmarLoteDePrueba(
      sesion(LUIS),
      { solicitanteId: ANA, liberadorId: LUIS, companyId: EMPRESA_B },
      deps,
    );
    assert.deepEqual(lote, {
      id: PEDRO,
      companyId: EMPRESA_A,
      solicitanteId: ANA,
      liberadorId: LUIS,
      firmadoEn: HORA,
      esPrueba: true,
    });
    assert.deepEqual(Object.keys(lote).sort(), [
      "companyId",
      "esPrueba",
      "firmadoEn",
      "id",
      "liberadorId",
      "solicitanteId",
    ]);
    assert.equal(JSON.stringify(lote).includes("monto"), false);

    const firmadoPorAdmin = await firmarLoteDePrueba(
      sesion(ANA),
      { solicitanteId: LUIS, liberadorId: ANA },
      { repositorio: repo, ahora: () => HORA, id: () => "55555555-5555-4555-8555-555555555555" },
    );
    assert.equal(firmadoPorAdmin.liberadorId, ANA);
    assert.equal(firmadoPorAdmin.solicitanteId, LUIS);
    assert.equal(firmadoPorAdmin.companyId, EMPRESA_A);
    assert.equal(firmadoPorAdmin.esPrueba, true);
    assert.equal(repo.lotes.length, 2);
  });

  it("no queda operable con una sola persona autorizada a soltar dinero", async () => {
    const repo = memoria();
    repo.sembrarUsuario(ANA);
    repo.sembrarUsuario(CARMEN);
    repo.sembrarMembresia({ userId: ANA, companyId: EMPRESA_A, rol: "administrador" });
    repo.sembrarMembresia({ userId: CARMEN, companyId: EMPRESA_A, rol: "contador" });
    assert.equal(empresaOperable(await repo.membresiasDeLaEmpresa(EMPRESA_A)), false);
    assert.equal(FIRMAS_DE_NOMINA, 2);

    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(ANA), { solicitanteId: CARMEN, liberadorId: ANA }, { repositorio: repo }),
      ),
      "empresa_no_operable",
    );
    assert.equal(repo.lotes.length, 0);
  });

  it("el contador no libera ni crea el lote cuando ya hay dos firmas posibles", async () => {
    const repo = libroOperable();
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(CARMEN), { solicitanteId: ANA, liberadorId: CARMEN }, { repositorio: repo }),
      ),
      "contador_no_libera",
    );
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(LUIS), { solicitanteId: CARMEN, liberadorId: LUIS }, { repositorio: repo }),
      ),
      "contador_no_crea_pago",
    );
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(ANA), { solicitanteId: ANA, liberadorId: LUIS }, { repositorio: repo }),
      ),
      "firma_ajena",
    );
    assert.equal(repo.lotes.length, 0);
  });

  it("rechaza dinero, una tercera firma y a quien no es de la empresa", async () => {
    const repo = libroOperable();
    const deps = { repositorio: repo };
    assert.equal(
      await codigo(firmarLoteDePrueba(sesion(LUIS), { solicitanteId: ANA, liberadorId: LUIS, monto: 1 }, deps)),
      "dinero_real_fuera",
    );
    assert.equal(
      await codigo(firmarLoteDePrueba(sesion(LUIS), { solicitante_id: ANA, liberadorId: LUIS }, deps)),
      "entrada_invalida",
    );
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(LUIS), { solicitanteId: ANA, liberadorId: LUIS, detalle: { centavos: 10 } }, deps),
      ),
      "dinero_real_fuera",
    );
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(LUIS), { solicitanteId: ANA, liberadorId: LUIS, estado: "enviado" }, deps),
      ),
      "dinero_real_fuera",
    );
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(LUIS), { solicitanteId: ANA, liberadorId: LUIS, esPrueba: false }, deps),
      ),
      "dinero_real_fuera",
    );
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(LUIS), { solicitanteId: ANA, liberadorId: LUIS, tercerFirmante: PEDRO }, deps),
      ),
      "tercera_firma",
    );
    repo.sembrarUsuario(PEDRO);
    repo.sembrarMembresia({ userId: PEDRO, companyId: EMPRESA_B, rol: "administrador" });
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(LUIS), { solicitanteId: PEDRO, liberadorId: LUIS, companyId: EMPRESA_B }, deps),
      ),
      "firmante_ajeno",
    );
    assert.equal(repo.lotes.length, 0);
  });

  it("quien solo solicita no libera, y al perder la segunda firma el lote deja de firmarse", async () => {
    const repo = libroOperable();
    repo.sembrarUsuario(PEDRO);
    repo.sembrarMembresia({ userId: PEDRO, companyId: EMPRESA_A, rol: "solicitante" });
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(PEDRO), { solicitanteId: ANA, liberadorId: PEDRO }, { repositorio: repo }),
      ),
      "sin_permiso_para_liberar",
    );
    await firmarLoteDePrueba(
      sesion(LUIS),
      { solicitanteId: PEDRO, liberadorId: LUIS },
      { repositorio: repo, ahora: () => HORA, id: () => "55555555-5555-4555-8555-555555555555" },
    );
    await cambiarRol(sesion(ANA), { userId: LUIS, rol: "contador" }, { repositorio: repo });
    assert.equal(empresaOperable(await repo.membresiasDeLaEmpresa(EMPRESA_A)), false);
    assert.equal(
      await codigo(
        firmarLoteDePrueba(sesion(ANA), { solicitanteId: PEDRO, liberadorId: ANA }, { repositorio: repo }),
      ),
      "empresa_no_operable",
    );
  });
});

describe("contrato de tablas", () => {
  it("queda en el módulo y no en las migraciones, sin columnas de dinero", () => {
    const sql = CONTRATO_TABLAS;
    assert.match(sql, /no es una migración/i);
    assert.match(sql, /solicitante_user_id <> liberador_user_id/);
    assert.match(sql, /CONSTRAINT lotes_prueba_es_prueba CHECK \(es_prueba\)/);
    assert.match(sql, /autorizados < 2/);
    for (const codigo of [
      "misma_persona_en_las_dos_firmas",
      "dinero_real_fuera",
      "firmante_ajeno",
      "contador_no_libera",
      "sin_permiso_para_liberar",
      "empresa_no_operable",
      "contador_no_crea_pago",
      "sin_permiso_para_solicitar",
    ]) {
      assert.equal(sql.includes(codigo), true, codigo);
    }

    const cuerpo = cuerpoDeTabla(sql, "lotes_prueba");
    assert.equal((cuerpo.match(/references users/gi) ?? []).length, 2);
    assert.equal((cuerpo.match(/references companies/gi) ?? []).length, 1);
    for (const palabra of ["monto", "centavo", "clabe", "spei", "enviado", "liquidado", "costo"]) {
      assert.equal(cuerpo.toLowerCase().includes(palabra), false, palabra);
    }

    assert.match(SQL.insertarLote, /values \(\$1, \$2, \$3, \$4, \$5, true\)/);
    assert.equal(SQL.insertarLote.includes("$6"), false);
    for (const columna of ["company_id", "solicitante_user_id", "liberador_user_id", "firmado_en", "es_prueba"]) {
      assert.equal(cuerpo.includes(columna), true, columna);
    }

    const directorio = path.join(RAIZ, "db/migrations");
    const archivos = readdirSync(directorio);
    assert.equal(archivos.some((nombre) => nombre.includes("lotes_prueba")), false);
    for (const nombre of archivos) {
      const texto = readFileSync(path.join(directorio, nombre), "utf8");
      assert.equal(texto.includes("lotes_prueba"), false, nombre);
    }
    const servicio = readFileSync(path.join(AQUI, "servicio.ts"), "utf8");
    assert.equal(servicio.includes("...entrada"), false);
    const migrador = readFileSync(path.join(RAIZ, "db/migrate.sh"), "utf8");
    assert.equal(migrador.includes("contrato.sql"), false);
    assert.equal(path.dirname(path.join(AQUI, "contrato.sql")).endsWith(`${path.sep}src${path.sep}server${path.sep}roles`), true);
  });
});

function sesion(userId: string, rol: Rol | null = null, companyId: string | null = null): Sesion {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    venceEn: HORA,
    usuario: { id: userId, nombre: "Ana Pérez", correo: "ana@ejemplo.mx" },
    companyId,
    rol,
  };
}

function libroOperable(): RepoMemoria {
  const repo = memoria();
  repo.sembrarUsuario(ANA);
  repo.sembrarUsuario(LUIS);
  repo.sembrarUsuario(CARMEN);
  repo.sembrarMembresia({ userId: ANA, companyId: EMPRESA_A, rol: "administrador" });
  repo.sembrarMembresia({ userId: LUIS, companyId: EMPRESA_A, rol: "liberador" });
  repo.sembrarMembresia({ userId: CARMEN, companyId: EMPRESA_A, rol: "contador" });
  return repo;
}

type RepoMemoria = RepositorioRoles & {
  lotes: LoteDePrueba[];
  sembrarUsuario: (userId: string) => void;
  sembrarMembresia: (membresia: Membresia) => void;
};

function memoria(): RepoMemoria {
  const usuarios = new Set<string>();
  const membresias = new Map<string, Membresia>();
  const lotes: LoteDePrueba[] = [];
  return {
    lotes,
    sembrarUsuario(userId) {
      usuarios.add(userId);
    },
    sembrarMembresia(membresia) {
      usuarios.add(membresia.userId);
      membresias.set(membresia.userId, { ...membresia });
    },
    usuarioExiste(userId) {
      return Promise.resolve(usuarios.has(userId));
    },
    membresiaDe(userId) {
      const encontrada = membresias.get(userId);
      return Promise.resolve(encontrada ? { ...encontrada } : null);
    },
    membresiasDeLaEmpresa(companyId) {
      return Promise.resolve(
        [...membresias.values()].filter((miembro) => miembro.companyId === companyId).map((miembro) => ({ ...miembro })),
      );
    },
    insertarMembresia(membresia) {
      if (!usuarios.has(membresia.userId)) return Promise.reject(new ErrorDeDominio("usuario_ausente"));
      const previa = membresias.get(membresia.userId);
      if (previa) {
        const codigo = previa.companyId === membresia.companyId ? "membresia_existente" : "segunda_razon_social";
        return Promise.reject(new ErrorDeDominio(codigo));
      }
      membresias.set(membresia.userId, { ...membresia });
      return Promise.resolve();
    },
    actualizarRol(membresia) {
      const previa = membresias.get(membresia.userId);
      if (!previa || previa.companyId !== membresia.companyId) {
        return Promise.reject(new ErrorDeDominio("sin_membresia"));
      }
      membresias.set(membresia.userId, { ...membresia });
      return Promise.resolve();
    },
    insertarLote(lote) {
      const codigo = loteNoGuardable(lote);
      if (codigo) return Promise.reject(new ErrorDeDominio(codigo));
      lotes.push({ ...lote, esPrueba: true });
      return Promise.resolve();
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
