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
import { conexionIniciada, traducirErrorDeBase } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { hashDeToken, tokenNuevo } from "./hash";
import { mapearSesion, SQL, type RepositorioSesion, type UsuarioInterno } from "./repositorio";
import { NOMBRE_COOKIE_PARCIAL } from "./cookie";
import { cerrarSesion, completarSegundoFactor, entrar, leerSesion, leerSesionParcial } from "./servicio";

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
  it("la contraseña abre una sesión parcial y el segundo factor la completa", async () => {
    const repo = memoria();
    const persona = usuario();
    repo.usuarios.set(persona.id, persona);
    const abierta = await entrar({ correo: "ana@ejemplo.mx", contrasena: CONTRASENA }, deps(repo));
    const guardada = [...repo.sesiones.values()][0];
    assert.equal(guardada?.tokenHash, hashDeToken(TOKEN));
    assert.equal(guardada?.completa, false);
    assert.match(abierta.setCookie, new RegExp(`^${NOMBRE_COOKIE_PARCIAL}=`));
    assert.equal(abierta.setCookie.includes(CONTRASENA), false);
    assert.equal(abierta.sesion.segundoFactor, null);
    assert.equal(await leerSesion(abierta.setCookie, deps(repo)), null);
    assert.equal((await leerSesionParcial(abierta.setCookie, deps(repo)))?.id, abierta.sesion.id);

    const completa = await completarSegundoFactor(abierta.setCookie, "totp", deps(repo, undefined, "c".repeat(43)));
    assert.equal(completa.sesion.segundoFactor?.metodo, "totp");
    assert.equal(repo.sesiones.size, 1);
    assert.equal((await leerSesion(completa.setCookies[0], deps(repo)))?.usuario.correo, "ana@ejemplo.mx");
    assert.equal(await leerSesionParcial(abierta.setCookie, deps(repo)), null);
    assert.equal(JSON.stringify(completa).includes("passwordHash"), false);
  });

  it("no abre sesión si el correo o la contraseña no sirven", async () => {
    const repo = memoria();
    let aperturas = 0;
    const original = repo.abrirSesion.bind(repo);
    repo.abrirSesion = async (sesion) => {
      aperturas += 1;
      return original(sesion);
    };
    assert.equal(await codigo(entrar({ correo: "no-es-correo", contrasena: CONTRASENA }, deps(repo))), "credenciales_invalidas");
    assert.equal(await codigo(entrar({ correo: "ana@ejemplo.mx", contrasena: "" }, deps(repo))), "credenciales_invalidas");
    assert.equal(aperturas, 0);
  });

  it("no dice si falló el correo o la contraseña", async () => {
    const repo = memoria();
    repo.usuarios.set("1", usuario());
    const verificaciones: string[] = [];
    const verificar = async (plana: string, hash: string) => {
      verificaciones.push(hash);
      return hash === `hash:${plana}`;
    };
    const dependencias = deps(repo, verificar);
    assert.equal(
      await codigo(entrar({ correo: "ANA@ejemplo.mx", contrasena: "otra-clave-99" }, dependencias)),
      "credenciales_invalidas",
    );
    assert.equal(
      await codigo(entrar({ correo: "nadie@ejemplo.mx", contrasena: CONTRASENA }, dependencias)),
      "credenciales_invalidas",
    );
    assert.equal(verificaciones.length, 2);
    assert.notEqual(verificaciones[1], `hash:${CONTRASENA}`);
    assert.equal(repo.fallos.length, 2);
  });

  it("caduca la sesión completa y cerrar solo borra el token presentado", async () => {
    const repo = memoria();
    let ahora = AHORA;
    const dependencias = deps(repo);
    dependencias.ahora = () => ahora;
    repo.usuarios.set("1", usuario());
    repo.usuarios.set("2", { ...usuario(), id: "2", correo: "luis@ejemplo.mx", nombre: "Luis Alma" });
    const ana = await entrar({ correo: "ana@ejemplo.mx", contrasena: CONTRASENA }, dependencias);
    const completa = await completarSegundoFactor(ana.setCookie, "passkey", {
      ...dependencias,
      token: () => "c".repeat(43),
    });
    ahora = new Date(AHORA.getTime() + VIGENCIA_SESION_MS - 1);
    assert.ok(await leerSesion(completa.setCookies[0], dependencias));
    ahora = new Date(AHORA.getTime() + VIGENCIA_SESION_MS);
    assert.equal(await leerSesion(completa.setCookies[0], dependencias), null);

    ahora = AHORA;
    const luis = await entrar({ correo: "luis@ejemplo.mx", contrasena: CONTRASENA }, { ...deps(repo), token: () => "d".repeat(43) });
    const luisCompleta = await completarSegundoFactor(luis.setCookie, "totp", { ...deps(repo), token: () => "e".repeat(43) });
    const cierre = await cerrarSesion(completa.setCookies[0], dependencias);
    assert.match(cierre.setCookies[0], /Max-Age=0/);
    assert.equal(await leerSesion(completa.setCookies[0], dependencias), null);
    assert.equal((await leerSesion(luisCompleta.setCookies[0], dependencias))?.usuario.correo, "luis@ejemplo.mx");
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
      "membresia_existente",
    );
    assert.equal(
      traducirErrorDeBase(
        Object.assign(new Error("x"), { code: "23505", constraint: "memberships_una_persona_una_empresa" }),
      ).message,
      "membresia_existente",
    );
    const categoria = traducirErrorDeBase(
      Object.assign(new Error("duplicate postgres://usuario:secreto@db.neon.tech/plataforma"), {
        code: "23505",
        constraint: "policy_categories_nombre_unico",
        table: "policy_categories",
      }),
    );
    assert.equal(categoria.message, "categoria_duplicada");
    assert.equal((categoria.stack ?? "").includes("secreto@"), false);
    assert.equal(
      traducirErrorDeBase(
        Object.assign(new Error("x"), {
          code: "23503",
          constraint: "policy_persons_miembro",
          table: "policy_persons",
        }),
      ).message,
      "persona_ajena",
    );
    assert.equal(
      traducirErrorDeBase(
        Object.assign(new Error("x"), {
          code: "23514",
          constraint: "policies_dias_comprobante",
          table: "policies",
        }),
      ).message,
      "politica_invalida",
    );
    const propio = new ErrorDeDominio("rfc_invalido");
    assert.equal(traducirErrorDeBase(propio), propio);
  });

  it("la lectura de sesión no trae el hash de la contraseña", () => {
    assert.match(SQL.buscarCorreo, /password_hash/);
    assert.doesNotMatch(SQL.buscarSesion, /password_hash/);
    assert.match(SQL.buscarSesion, /sesion_por_token/);
    assert.doesNotMatch(SQL.buscarSesion, /memberships/);
    assert.match(SQL.completar, /segundo_factor_en/);
    const fuenteRepo = readFileSync(new URL("./repositorio.ts", import.meta.url), "utf8");
    assert.match(fuenteRepo, /consulta\.query\(SQL\.borrarSesionesDelUsuario/);
    const sesion = mapearSesion({
      id: randomUUID(),
      expires_at: AHORA,
      user_id: randomUUID(),
      nombre: "Ana",
      correo: "ana@ejemplo.mx",
      segundo_factor_en: null,
      segundo_factor_metodo: null,
      password_hash: "secreto",
    });
    assert.equal(sesion.segundoFactor, null);
    assert.equal(JSON.stringify(sesion).includes("secreto"), false);
    assert.equal(
      mapearSesion({
        id: randomUUID(),
        expires_at: AHORA,
        user_id: randomUUID(),
        nombre: "Ana",
        correo: "ana@ejemplo.mx",
        segundo_factor_en: AHORA,
        segundo_factor_metodo: "passkey",
      }).segundoFactor?.metodo,
      "passkey",
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

type SesionMem = { id: string; userId: string; tokenHash: string; expiresAt: Date; completa: boolean };

function usuario(): UsuarioInterno {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nombre: "Ana Pérez",
    correo: "ana@ejemplo.mx",
    passwordHash: `hash:${CONTRASENA}`,
  };
}

function memoria(): RepositorioSesion & {
  usuarios: Map<string, UsuarioInterno>;
  sesiones: Map<string, SesionMem>;
  fallos: Array<string | null>;
} {
  const usuarios = new Map<string, UsuarioInterno>();
  const sesiones = new Map<string, SesionMem>();
  const fallos: Array<string | null> = [];
  function aSesion(fila: SesionMem) {
    const persona = [...usuarios.values()].find((actual) => actual.id === fila.userId);
    if (!persona) return null;
    return {
      id: fila.id,
      venceEn: fila.expiresAt,
      usuario: { id: persona.id, nombre: persona.nombre, correo: persona.correo },
      segundoFactor: fila.completa ? { metodo: "totp" as const, en: AHORA } : null,
    };
  }
  return {
    usuarios,
    sesiones,
    fallos,
    async buscarPorCorreo(correo) {
      return [...usuarios.values()].find((actual) => actual.correo === correo) ?? null;
    },
    async abrirSesion(sesion) {
      for (const [hash, guardada] of [...sesiones.entries()]) {
        if (guardada.userId === sesion.userId) sesiones.delete(hash);
      }
      sesiones.set(sesion.tokenHash, { ...sesion, completa: false });
    },
    async buscarPorTokenHash(tokenHash, ahora, completa) {
      const fila = sesiones.get(tokenHash);
      if (!fila || fila.expiresAt.getTime() <= ahora.getTime() || fila.completa !== completa) return null;
      return aSesion(fila);
    },
    async completarSegundoFactor(verificado) {
      const parcial = sesiones.get(verificado.tokenHashParcial);
      if (!parcial || parcial.completa) throw new ErrorDeDominio("sesion_ausente");
      sesiones.delete(verificado.tokenHashParcial);
      const fila: SesionMem = {
        ...parcial,
        tokenHash: verificado.tokenHashCompleto,
        expiresAt: verificado.expiresAt,
        completa: true,
      };
      sesiones.set(fila.tokenHash, fila);
      const sesion = aSesion(fila);
      if (!sesion) throw new ErrorDeDominio("base_no_disponible");
      return { ...sesion, segundoFactor: { metodo: verificado.metodo, en: verificado.ahora } };
    },
    async borrarPorTokenHash(tokenHash) {
      sesiones.delete(tokenHash);
    },
    async registrarFallo(userId) {
      fallos.push(userId);
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
