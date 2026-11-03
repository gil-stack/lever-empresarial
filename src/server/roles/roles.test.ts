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
import { asignarMembresia, cambiarRol, entrarAPoliza, liberarLoteDePrueba, solicitarLoteDePrueba } from "./servicio.ts";
import type { FilaDeLote, Membresia, RepositorioRoles } from "./tipos.ts";

const ANA = "11111111-1111-4111-8111-111111111111";
const LUIS = "22222222-2222-4222-8222-222222222222";
const CARMEN = "33333333-3333-4333-8333-333333333333";
const PEDRO = "44444444-4444-4444-8444-444444444444";
const ROSA = "77777777-7777-4777-8777-777777777777";
const LOTE = "55555555-5555-4555-8555-555555555555";
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
    assert.equal(puedeSoltarDinero("administrador"), false);
    assert.equal(puedeEntrarAPoliza("administrador"), false);
    assert.equal(puedeSoltarDinero(QUIEN_LIBERA), true);
    assert.deepEqual(accionesDe("administrador"), ["administrar_membresias", "solicitar"]);
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
    assert.equal(await codigo(entrarAPoliza(sesion(ANA), { repositorio: repo })), "sin_entrada_a_poliza");
  });
});

describe("lote de prueba con dos firmas", () => {
  it("dos actos de dos usuarios, y el administrador no libera", async () => {
    const repo = libroOperable();
    const deps = { repositorio: repo, ahora: () => HORA, id: () => LOTE };
    assert.equal(
      await codigo(solicitarLoteDePrueba(sesion(LUIS), { solicitanteId: LUIS, liberadorId: LUIS }, deps)),
      "misma_persona_en_las_dos_firmas",
    );
    assert.equal(
      await codigo(solicitarLoteDePrueba(sesion(LUIS), { solicitanteId: LUIS.toUpperCase(), liberadorId: LUIS }, deps)),
      "misma_persona_en_las_dos_firmas",
    );
    assert.equal(
      await codigo(solicitarLoteDePrueba(sesion(LUIS), { solicitanteId: ANA, liberadorId: LUIS }, deps)),
      "firma_en_un_solo_acto",
    );
    assert.equal(
      loteNoGuardable({ solicitanteId: LUIS, liberadorId: LUIS.toUpperCase(), esPrueba: true }),
      "misma_persona_en_las_dos_firmas",
    );
    assert.equal(repo.lotes.length, 0);

    const solicitud = await solicitarLoteDePrueba(sesion(LUIS), { companyId: EMPRESA_B }, deps);
    assert.equal(solicitud.companyId, EMPRESA_A);
    assert.equal(solicitud.solicitanteId, LUIS);
    assert.equal(solicitud.liberadorId, null);
    assert.equal(solicitud.liberadoEn, null);
    assert.equal(solicitud.esPrueba, true);
    assert.equal(JSON.stringify(solicitud).includes("monto"), false);

    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(LUIS.toUpperCase()), { loteId: solicitud.id }, deps)),
      "misma_persona_en_las_dos_firmas",
    );
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(ANA), { loteId: solicitud.id }, deps)),
      "sin_permiso_para_liberar",
    );

    const despues = new Date("2026-11-03T19:00:00.000Z");
    const lote = await liberarLoteDePrueba(
      sesion(ROSA),
      { loteId: solicitud.id, companyId: EMPRESA_B },
      { repositorio: repo, ahora: () => despues },
    );
    assert.equal(lote.liberadorId, ROSA);
    assert.equal(lote.solicitanteId, LUIS);
    assert.equal(lote.companyId, EMPRESA_A);
    assert.equal(lote.solicitadoEn.toISOString(), HORA.toISOString());
    assert.equal(lote.liberadoEn.toISOString(), despues.toISOString());
    assert.equal(lote.esPrueba, true);
    assert.equal(repo.lotes.length, 1);
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(ROSA), { loteId: solicitud.id }, deps)),
      "lote_ya_firmado",
    );
  });

  it("no queda operable con una sola persona autorizada, ni con el administrador", async () => {
    const repo = memoria();
    repo.sembrarUsuario(ANA);
    repo.sembrarUsuario(LUIS);
    repo.sembrarUsuario(ROSA);
    repo.sembrarUsuario(CARMEN);
    repo.sembrarMembresia({ userId: ANA, companyId: EMPRESA_A, rol: "administrador" });
    repo.sembrarMembresia({ userId: CARMEN, companyId: EMPRESA_A, rol: "contador" });
    repo.sembrarMembresia({ userId: ROSA, companyId: EMPRESA_A, rol: "administrador" });
    assert.equal(empresaOperable(await repo.membresiasDeLaEmpresa(EMPRESA_A)), false);
    assert.equal(FIRMAS_DE_NOMINA, 2);

    repo.sembrarMembresia({ userId: LUIS, companyId: EMPRESA_A, rol: "liberador" });
    assert.equal(empresaOperable(await repo.membresiasDeLaEmpresa(EMPRESA_A)), false);
    assert.equal(
      await codigo(solicitarLoteDePrueba(sesion(LUIS), {}, { repositorio: repo })),
      "empresa_no_operable",
    );
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(ANA), { loteId: LOTE }, { repositorio: repo })),
      "lote_ausente",
    );

    repo.sembrarMembresia({ userId: LUIS, companyId: EMPRESA_A, rol: "liberador", deBaja: true });
    const otra = memoria();
    otra.sembrarMembresia({ userId: LUIS, companyId: EMPRESA_A, rol: "liberador", deBaja: true });
    otra.sembrarMembresia({ userId: ROSA, companyId: EMPRESA_A, rol: "liberador" });
    assert.equal(empresaOperable(await otra.membresiasDeLaEmpresa(EMPRESA_A)), false);
  });

  it("el contador no libera ni crea el lote cuando ya hay dos firmas posibles", async () => {
    const repo = libroOperable();
    const deps = { repositorio: repo, ahora: () => HORA, id: () => LOTE };
    assert.equal(await codigo(solicitarLoteDePrueba(sesion(CARMEN), {}, deps)), "contador_no_crea_pago");
    const solicitud = await solicitarLoteDePrueba(sesion(LUIS), {}, deps);
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(CARMEN), { loteId: solicitud.id }, deps)),
      "contador_no_libera",
    );
    assert.equal(
      await codigo(solicitarLoteDePrueba(sesion(LUIS), { solicitanteId: ANA }, deps)),
      "firma_ajena",
    );
    assert.equal(repo.lotes.filter((fila) => fila.liberadorId).length, 0);
  });

  it("rechaza dinero, una tercera firma y a quien no es de la empresa", async () => {
    const repo = libroOperable();
    const deps = { repositorio: repo, ahora: () => HORA, id: () => LOTE };
    assert.equal(await codigo(solicitarLoteDePrueba(sesion(LUIS), { monto: 1 }, deps)), "dinero_real_fuera");
    assert.equal(await codigo(solicitarLoteDePrueba(sesion(LUIS), { solicitante_id: ANA }, deps)), "entrada_invalida");
    assert.equal(
      await codigo(solicitarLoteDePrueba(sesion(LUIS), { detalle: { centavos: 10 } }, deps)),
      "dinero_real_fuera",
    );
    assert.equal(await codigo(solicitarLoteDePrueba(sesion(LUIS), { estado: "enviado" }, deps)), "dinero_real_fuera");
    assert.equal(await codigo(solicitarLoteDePrueba(sesion(LUIS), { esPrueba: false }, deps)), "dinero_real_fuera");
    assert.equal(
      await codigo(solicitarLoteDePrueba(sesion(LUIS), { tercerFirmante: PEDRO }, deps)),
      "tercera_firma",
    );
    const solicitud = await solicitarLoteDePrueba(sesion(LUIS), {}, deps);
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(ROSA), { loteId: solicitud.id, monto: 1 }, deps)),
      "dinero_real_fuera",
    );
    repo.sembrarUsuario(PEDRO);
    repo.sembrarMembresia({ userId: PEDRO, companyId: EMPRESA_B, rol: "administrador" });
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(PEDRO), { loteId: solicitud.id, companyId: EMPRESA_B }, deps)),
      "firmante_ajeno",
    );
    assert.equal(repo.lotes.filter((fila) => fila.liberadorId).length, 0);
  });

  it("quien solo solicita no libera, y al perder la segunda firma el lote deja de cerrarse", async () => {
    const repo = libroOperable();
    repo.sembrarUsuario(PEDRO);
    repo.sembrarMembresia({ userId: PEDRO, companyId: EMPRESA_A, rol: "solicitante" });
    const deps = { repositorio: repo, ahora: () => HORA, id: () => LOTE };
    const solicitud = await solicitarLoteDePrueba(sesion(PEDRO), {}, deps);
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(PEDRO), { loteId: solicitud.id }, deps)),
      "misma_persona_en_las_dos_firmas",
    );
    await cambiarRol(sesion(ANA), { userId: LUIS, rol: "contador" }, { repositorio: repo });
    assert.equal(empresaOperable(await repo.membresiasDeLaEmpresa(EMPRESA_A)), false);
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(ROSA), { loteId: solicitud.id }, deps)),
      "empresa_no_operable",
    );
    assert.equal(
      await codigo(liberarLoteDePrueba(sesion(ANA), { loteId: solicitud.id }, deps)),
      "sin_permiso_para_liberar",
    );
  });
});

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
  repo.sembrarUsuario(ROSA);
  repo.sembrarUsuario(CARMEN);
  repo.sembrarMembresia({ userId: ANA, companyId: EMPRESA_A, rol: "administrador" });
  repo.sembrarMembresia({ userId: LUIS, companyId: EMPRESA_A, rol: "liberador" });
  repo.sembrarMembresia({ userId: ROSA, companyId: EMPRESA_A, rol: "liberador" });
  repo.sembrarMembresia({ userId: CARMEN, companyId: EMPRESA_A, rol: "contador" });
  return repo;
}

type RepoMemoria = RepositorioRoles & {
  lotes: FilaDeLote[];
  sembrarUsuario: (userId: string) => void;
  sembrarMembresia: (membresia: Membresia) => void;
};

function memoria(): RepoMemoria {
  const usuarios = new Set<string>();
  const membresias = new Map<string, Membresia>();
  const lotes: FilaDeLote[] = [];

  function claveDe(mapa: Map<string, Membresia>, userId: string): string | undefined {
    return [...mapa.keys()].find((clave) => clave.toLowerCase() === userId.toLowerCase());
  }

  return {
    lotes,
    sembrarUsuario(userId) {
      usuarios.add(userId.toLowerCase());
    },
    sembrarMembresia(membresia) {
      const guardada = { ...membresia, userId: membresia.userId.toLowerCase() };
      usuarios.add(guardada.userId);
      membresias.set(guardada.userId, guardada);
    },
    usuarioExiste(userId) {
      return Promise.resolve(usuarios.has(userId.toLowerCase()));
    },
    membresiaDe(userId) {
      const clave = claveDe(membresias, userId);
      const encontrada = clave ? membresias.get(clave) : undefined;
      return Promise.resolve(encontrada ? { ...encontrada } : null);
    },
    membresiasDeLaEmpresa(companyId) {
      return Promise.resolve(
        [...membresias.values()].filter((miembro) => miembro.companyId === companyId).map((miembro) => ({ ...miembro })),
      );
    },
    insertarMembresia(membresia) {
      const userId = membresia.userId.toLowerCase();
      if (!usuarios.has(userId)) return Promise.reject(new ErrorDeDominio("usuario_ausente"));
      const previa = membresias.get(userId);
      if (previa) {
        const codigoFirma = previa.companyId === membresia.companyId ? "membresia_existente" : "segunda_razon_social";
        return Promise.reject(new ErrorDeDominio(codigoFirma));
      }
      membresias.set(userId, { ...membresia, userId });
      return Promise.resolve();
    },
    actualizarRol(membresia) {
      const clave = claveDe(membresias, membresia.userId);
      const previa = clave ? membresias.get(clave) : undefined;
      if (!previa || previa.companyId !== membresia.companyId) {
        return Promise.reject(new ErrorDeDominio("sin_membresia"));
      }
      membresias.set(previa.userId, { ...previa, rol: membresia.rol });
      return Promise.resolve();
    },
    insertarSolicitud(solicitud) {
      const codigoFirma = loteNoGuardable(solicitud);
      if (codigoFirma) return Promise.reject(new ErrorDeDominio(codigoFirma));
      lotes.push({ ...solicitud, esPrueba: true });
      return Promise.resolve();
    },
    leerLote(id) {
      const fila = lotes.find((actual) => actual.id === id);
      return Promise.resolve(fila ? { ...fila } : null);
    },
    cerrarLiberacion(lote) {
      const codigoFirma = loteNoGuardable(lote);
      if (codigoFirma) return Promise.reject(new ErrorDeDominio(codigoFirma));
      const indice = lotes.findIndex((actual) => actual.id === lote.id && actual.companyId === lote.companyId);
      const previa = indice >= 0 ? lotes[indice] : undefined;
      if (!previa || previa.liberadorId) return Promise.reject(new ErrorDeDominio("lote_ya_firmado"));
      lotes[indice] = { ...lote, esPrueba: true };
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

