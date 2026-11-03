import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  encabezadoCerrarSesion,
  encabezadoDeSesion,
  leerToken,
  NOMBRE_COOKIE,
  VIGENCIA_SESION_MS,
} from "./cookie";
import { conexionIniciada, traducirErrorDeBase } from "./db";
import { ErrorDeDominio } from "./error-de-dominio";
import { hashDeToken, tokenNuevo } from "./hash";
import { mapearSesion, SQL, type RepositorioSesion, type UsuarioInterno } from "./repositorio";
import { abrirCuenta, cerrarSesion, descartarCuentaSinEmpresa, entrar, leerSesion } from "./servicio";
import { validarCuenta } from "./validar";

const AHORA = new Date("2026-11-03T10:00:00.000Z");
const TOKEN = "b".repeat(43);
const CONTRASENA = "clave-segura-12";

describe("cookie de sesión", () => {
  it("viaja en HttpOnly, Secure y SameSite, sin dominio", () => {
    const vence = new Date(AHORA.getTime() + VIGENCIA_SESION_MS);
    assert.equal(
      encabezadoDeSesion(TOKEN, vence, AHORA),
      `${NOMBRE_COOKIE}=${TOKEN}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200; Expires=${vence.toUTCString()}`,
    );
    assert.equal(
      encabezadoCerrarSesion(),
      `${NOMBRE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    );
  });

  it("solo acepta el token opaco de 43 caracteres", () => {
    assert.equal(leerToken(undefined), null);
    assert.equal(leerToken(`${NOMBRE_COOKIE}=`), null);
    assert.equal(leerToken(`${NOMBRE_COOKIE}=abc`), null);
    assert.equal(leerToken(`sesion_extra=${TOKEN}`), null);
    assert.equal(leerToken(`otra=1; ${NOMBRE_COOKIE}=${encodeURIComponent(TOKEN)}`), TOKEN);
    assert.equal(leerToken(`${NOMBRE_COOKIE}=${TOKEN}; ${"x".repeat(5000)}`), null);
    assert.throws(() => encabezadoDeSesion("abc", AHORA, AHORA), (error: unknown) => {
      return error instanceof ErrorDeDominio && error.codigo === "sesion_ausente";
    });
  });
});

describe("cuenta y sesión", () => {
  it("guarda el hash del token y el hash de la contraseña, y no los devuelve", async () => {
    const repo = memoria();
    const abierta = await abrirCuenta(cuenta(), deps(repo));
    const guardada = [...repo.sesiones.values()][0];
    const usuario = [...repo.usuarios.values()][0];
    assert.equal(guardada?.tokenHash, hashDeToken(TOKEN));
    assert.notEqual(guardada?.tokenHash, TOKEN);
    assert.equal(usuario?.passwordHash, `hash:${CONTRASENA}`);
    assert.equal(usuario?.correo, "ana@ejemplo.mx");
    assert.equal(usuario?.nombre, "Ana Pérez");
    assert.equal(abierta.setCookie.includes(TOKEN), true);
    assert.equal(abierta.setCookie.includes(CONTRASENA), false);
    assert.equal(abierta.setCookie.includes(usuario?.passwordHash ?? "hash:"), false);
    assert.deepEqual(Object.keys(abierta.sesion.usuario).sort(), ["correo", "id", "nombre"]);
    assert.equal(abierta.sesion.companyId, null);
    assert.equal(JSON.stringify(abierta).includes("passwordHash"), false);

    const leida = await leerSesion(abierta.setCookie, deps(repo));
    assert.equal(leida?.usuario.correo, "ana@ejemplo.mx");
    assert.equal(leida?.id, abierta.sesion.id);
  });

  it("no escribe la base si la cuenta es inválida", async () => {
    const repo = memoria();
    let escrituras = 0;
    repo.crearCuenta = async (registro) => {
      escrituras += 1;
      return memoria().crearCuenta(registro);
    };
    assert.equal(
      await codigo(abrirCuenta({ nombre: " ", correo: "ana@ejemplo.mx", contrasena: CONTRASENA }, deps(repo))),
      "nombre_invalido",
    );
    assert.equal(await codigo(abrirCuenta(cuenta({ contrasena: "corta" }), deps(repo))), "contrasena_invalida");
    assert.equal(await codigo(abrirCuenta(cuenta({ contrasena: "a".repeat(73) }), deps(repo))), "contrasena_invalida");
    assert.equal(await codigo(abrirCuenta(cuenta({ contrasena: "ñ".repeat(37) }), deps(repo))), "contrasena_invalida");
    assert.equal(validarCuenta(cuenta({ contrasena: "a".repeat(72) })).ok, true);
    assert.equal(validarCuenta(cuenta({ contrasena: "ñ".repeat(36) })).ok, true);
    assert.equal(await codigo(abrirCuenta(cuenta({ correo: "no-es-correo" }), deps(repo))), "correo_invalido");
    assert.equal(escrituras, 0);
  });

  it("rechaza el correo repetido y no dice si la contraseña o el correo existen al entrar", async () => {
    const repo = memoria();
    const primera = await abrirCuenta(cuenta(), deps(repo));
    assert.equal(await codigo(abrirCuenta(cuenta({ nombre: "Otra" }), deps(repo))), "correo_duplicado");

    const verificaciones: string[] = [];
    const verificar = async (plana: string, hash: string) => {
      verificaciones.push(hash);
      return hash === `hash:${plana}`;
    };
    const dependencias = deps(repo, verificar);
    assert.equal(await codigo(entrar({ correo: "ANA@ejemplo.mx", contrasena: "otra-clave-99" }, dependencias)), "credenciales_invalidas");
    assert.equal(await codigo(entrar({ correo: "nadie@ejemplo.mx", contrasena: CONTRASENA }, dependencias)), "credenciales_invalidas");
    assert.equal(verificaciones.length, 2);
    assert.equal(verificaciones[1]?.startsWith("hash:"), true);
    assert.notEqual(verificaciones[1], `hash:${CONTRASENA}`);

    const segunda = await entrar({ correo: "ana@ejemplo.mx", contrasena: CONTRASENA }, deps(repo, verificar, "c".repeat(43)));
    assert.equal(repo.sesiones.size, 1);
    assert.notEqual(segunda.sesion.id, primera.sesion.id);
    assert.equal(await leerSesion(primera.setCookie, deps(repo)), null);
    assert.equal((await leerSesion(segunda.setCookie, deps(repo)))?.id, segunda.sesion.id);
    assert.equal(JSON.stringify(segunda).includes(CONTRASENA), false);
  });

  it("caduca la sesión y cerrar solo borra el token presentado", async () => {
    const repo = memoria();
    let ahora = AHORA;
    const dependencias = deps(repo);
    dependencias.ahora = () => ahora;
    const abierta = await abrirCuenta(cuenta(), dependencias);
    ahora = new Date(AHORA.getTime() + VIGENCIA_SESION_MS - 1);
    assert.ok(await leerSesion(abierta.setCookie, dependencias));
    ahora = new Date(AHORA.getTime() + VIGENCIA_SESION_MS);
    assert.equal(await leerSesion(abierta.setCookie, dependencias), null);

    ahora = AHORA;
    const luis = await abrirCuenta(
      cuenta({ nombre: "Luis Alma", correo: "luis@ejemplo.mx" }),
      { ...deps(repo), token: () => "d".repeat(43) },
    );
    const vigente = await entrar({ correo: "ana@ejemplo.mx", contrasena: CONTRASENA }, dependencias);
    const cierre = await cerrarSesion(vigente.setCookie, dependencias);
    assert.match(cierre.setCookie, /Max-Age=0/);
    assert.equal(await leerSesion(vigente.setCookie, dependencias), null);
    assert.equal((await leerSesion(luis.setCookie, dependencias))?.usuario.correo, "luis@ejemplo.mx");
    assert.equal((await cerrarSesion(null, dependencias)).setCookie.includes("Secure"), true);
    assert.equal(await leerSesion(null, dependencias), null);
  });

  it("borra la cuenta nueva solo si no tiene empresa", async () => {
    const repo = memoria();
    const abierta = await abrirCuenta(cuenta(), deps(repo));
    assert.equal(await descartarCuentaSinEmpresa("no-es-uuid", deps(repo)), false);
    assert.equal(await descartarCuentaSinEmpresa(abierta.sesion.usuario.id, deps(repo)), true);
    assert.equal(repo.usuarios.size, 0);
    assert.equal(repo.sesiones.size, 0);

    const conEmpresa = await abrirCuenta(cuenta({ correo: "con-empresa@ejemplo.mx" }), deps(repo, undefined, "e".repeat(43)));
    repo.marcarEmpresa(conEmpresa.sesion.usuario.id);
    assert.equal(await descartarCuentaSinEmpresa(conEmpresa.sesion.usuario.id, deps(repo)), false);
    assert.equal(repo.usuarios.has(conEmpresa.sesion.usuario.id), true);
    assert.equal(repo.sesiones.size, 1);
  });
});

describe("errores de base", () => {
  it("no copia el connection string ni el mensaje del driver", () => {
    const duplicado = traducirErrorDeBase(
      Object.assign(new Error("connect postgres://usuario:secreto@db.neon.tech/plataforma"), {
        code: "23505",
        constraint: "companies_rfc_key",
        table: "companies",
      }),
    );
    assert.equal(duplicado.message, "rfc_duplicado");
    assert.equal((duplicado as { cause?: unknown }).cause, undefined);
    assert.equal((duplicado.stack ?? "").includes("secreto@"), false);

    assert.equal(
      traducirErrorDeBase(Object.assign(new Error("duplicate rfc postgres://usuario:secreto@host/db"), { code: "23505" }))
        .message,
      "base_no_disponible",
    );
    assert.equal(
      traducirErrorDeBase(new Error("password authentication failed postgres://a:b@h/db")).message,
      "base_no_disponible",
    );
    assert.equal(
      traducirErrorDeBase(Object.assign(new Error("x"), { code: "23505", constraint: "users_correo_key" })).message,
      "correo_duplicado",
    );
    assert.equal(
      traducirErrorDeBase(Object.assign(new Error("x"), { code: "23505", constraint: "sessions_token_hash_key" })).message,
      "sesion_duplicada",
    );
    assert.equal(
      traducirErrorDeBase(Object.assign(new Error("x"), { code: "23505", constraint: "memberships_pkey" })).message,
      "segunda_razon_social",
    );
    assert.equal(
      traducirErrorDeBase(
        Object.assign(new Error("x"), { code: "23505", constraint: "memberships_una_persona_una_empresa" }),
      ).message,
      "segunda_razon_social",
    );
    const propio = new ErrorDeDominio("rfc_invalido");
    assert.equal(traducirErrorDeBase(propio), propio);
  });

  it("la lectura de sesión no trae el hash de la contraseña", () => {
    assert.match(SQL.buscarCorreo, /password_hash/);
    assert.doesNotMatch(SQL.buscarSesion, /password_hash/);
    assert.match(SQL.buscarSesion, /memberships/);
    assert.match(SQL.borrarSesionesDelUsuario, /delete from sessions where user_id = \$1/i);
    assert.match(SQL.borrarUsuario, /delete from users where id = \$1/i);
    assert.match(SQL.tieneMembresia, /from memberships where user_id = \$1/i);
    assert.match(SQL.bloquearUsuario, /for update/i);
    const fuenteRepo = readFileSync(new URL("./repositorio.ts", import.meta.url), "utf8");
    assert.match(fuenteRepo, /consulta\.query\(SQL\.borrarSesionesDelUsuario/);
    const sesion = mapearSesion({
      id: randomUUID(),
      expires_at: AHORA,
      user_id: randomUUID(),
      nombre: "Ana",
      correo: "ana@ejemplo.mx",
      company_id: randomUUID(),
      rol: "administrador_falso",
      password_hash: "secreto",
    });
    assert.equal(sesion.rol, null);
    assert.equal(JSON.stringify(sesion).includes("secreto"), false);
    assert.equal(
      mapearSesion({
        id: randomUUID(),
        expires_at: AHORA,
        user_id: randomUUID(),
        nombre: "Ana",
        correo: "ana@ejemplo.mx",
        company_id: null,
        rol: "contador",
      }).rol,
      "contador",
    );
  });
});

describe("el módulo no arranca trabajo", () => {
  it("importar no abre la base", async () => {
    await import("./index.ts");
    await import("../company/index.ts");
    assert.equal(conexionIniciada(), false);
  });

  it("el fuente no registra la conexión ni migra", () => {
    const raiz = dirname(fileURLToPath(import.meta.url));
    const archivos = [...archivosTs(raiz), ...archivosTs(join(raiz, "../company"))];
    assert.ok(archivos.length >= 8);
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8");
      assert.doesNotMatch(fuente, /\bconsole\b/);
      assert.doesNotMatch(fuente, /process\.(stdout|stderr)/);
      assert.doesNotMatch(fuente, /\bmigrate\b/i);
      assert.doesNotMatch(fuente, /migrations/);
      assert.doesNotMatch(fuente, /grupo_id/);
      assert.doesNotMatch(fuente, /DIRECT_URL|DATABASE_URL_UNPOOLED|NON_POOLING/);
      assert.doesNotMatch(fuente, /postgres(?:ql)?:\/\/[^"'\s]/);
      assert.doesNotMatch(fuente, /\$\{[^}]*(connectionString|DATABASE_URL)/);
      const lecturas = fuente.match(/process\.env(?:\??)\.[A-Za-z0-9_]+/g) ?? [];
      for (const lectura of lecturas) {
        assert.equal(archivo.endsWith("/db.ts") || archivo.endsWith("\\db.ts"), true);
        assert.match(lectura, /DATABASE_URL$/);
      }
    }
  });
});

describe("bcrypt", () => {
  it("guarda la contraseña con costo 12 y no con el texto", async () => {
    const { hashearContrasena, verificarContrasena } = await import("./hash.ts");
    const hash = await hashearContrasena(CONTRASENA);
    const otro = await hashearContrasena(CONTRASENA);
    assert.match(hash, /^\$2[ab]\$12\$/);
    assert.notEqual(hash, CONTRASENA);
    assert.notEqual(hash, otro);
    assert.equal(await verificarContrasena(CONTRASENA, hash), true);
    assert.equal(await verificarContrasena("otra-clave-99", hash), false);
    assert.equal(hashDeToken(TOKEN), createHash("sha256").update(TOKEN).digest("hex"));
    assert.equal(tokenNuevo().length, 43);
  });
});

function cuenta(parcial: Partial<{ nombre: string; correo: string; contrasena: string }> = {}) {
  return {
    nombre: "  Ana   Pérez ",
    correo: "  ANA@ejemplo.mx ",
    contrasena: CONTRASENA,
    ...parcial,
  };
}

function deps(
  repositorio: RepositorioSesion,
  verificar: (plana: string, hash: string) => Promise<boolean> = async (plana, hash) => hash === `hash:${plana}`,
  token = TOKEN,
) {
  return {
    repositorio,
    ahora: () => AHORA,
    token: () => token,
    hashear: async (contrasena: string) => `hash:${contrasena}`,
    verificar,
  };
}

function memoria(): RepositorioSesion & {
  usuarios: Map<string, UsuarioInterno>;
  sesiones: Map<string, { id: string; userId: string; tokenHash: string; expiresAt: Date }>;
  marcarEmpresa: (userId: string) => void;
} {
  const usuarios = new Map<string, UsuarioInterno>();
  const sesiones = new Map<string, { id: string; userId: string; tokenHash: string; expiresAt: Date }>();
  const conEmpresa = new Set<string>();
  return {
    usuarios,
    sesiones,
    marcarEmpresa(userId) {
      conEmpresa.add(userId);
    },
    async crearCuenta(registro) {
      if ([...usuarios.values()].some((usuario) => usuario.correo === registro.usuario.correo)) {
        throw new ErrorDeDominio("correo_duplicado");
      }
      usuarios.set(registro.usuario.id, registro.usuario);
      sesiones.set(registro.sesion.tokenHash, registro.sesion);
    },
    async buscarPorCorreo(correo) {
      return [...usuarios.values()].find((usuario) => usuario.correo === correo) ?? null;
    },
    async abrirSesion(sesion) {
      for (const [hash, guardada] of [...sesiones.entries()]) {
        if (guardada.userId === sesion.userId) sesiones.delete(hash);
      }
      sesiones.set(sesion.tokenHash, sesion);
    },
    async buscarPorTokenHash(tokenHash, ahora) {
      const sesion = sesiones.get(tokenHash);
      if (!sesion || sesion.expiresAt.getTime() <= ahora.getTime()) return null;
      const usuario = usuarios.get(sesion.userId);
      if (!usuario) return null;
      return {
        id: sesion.id,
        venceEn: sesion.expiresAt,
        usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo },
        companyId: null,
        rol: null,
      };
    },
    async borrarPorTokenHash(tokenHash) {
      sesiones.delete(tokenHash);
    },
    async descartarCuentaSinEmpresa(userId) {
      if (!usuarios.has(userId) || conEmpresa.has(userId)) return false;
      usuarios.delete(userId);
      for (const [hash, sesion] of [...sesiones.entries()]) {
        if (sesion.userId === userId) sesiones.delete(hash);
      }
      return true;
    },
  };
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

function archivosTs(dir: string): string[] {
  return readdirSync(dir)
    .filter((nombre) => nombre.endsWith(".ts") && !nombre.endsWith(".test.ts"))
    .map((nombre) => join(dir, nombre));
}
