import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  encabezadoCerrarSesion,
  encabezadoDeSesion,
  INACTIVIDAD_SESION_MS,
  leerToken,
  NOMBRE_COOKIE,
  nombreDeCookie,
  RENOVACION_USO_MS,
  VIGENCIA_SESION_MS,
} from "./cookie";
import { conexionIniciada, traducirErrorDeBase } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { hashDeToken, tokenNuevo } from "./hash";
import { mapearSesion, SQL, type RepositorioSesion, type UsuarioInterno } from "./repositorio";
import { NOMBRE_COOKIE_PARCIAL } from "./cookie";
import { cerrarSesion, leerSesion, leerSesionParcial } from "./servicio";

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

describe("cookies __Host- e inactividad", () => {
  it("en producción las cookies de acceso llevan __Host-; en desarrollo no", () => {
    for (const base of ["sesion", "sesion_parcial", "entrada", "portal", "entrada_operacion", "portal_operacion"]) {
      assert.equal(nombreDeCookie(base, "production"), `__Host-${base}`);
      assert.equal(nombreDeCookie(base, "development"), base);
      assert.equal(nombreDeCookie(base, undefined), base);
    }
    // __Host- exige Secure, Path=/ y ningún Domain: el encabezado ya los cumple.
    const encabezado = encabezadoDeSesion(TOKEN, new Date(AHORA.getTime() + 60_000), AHORA);
    assert.match(encabezado, /; Secure;/);
    assert.match(encabezado, /; Path=\/;/);
    assert.doesNotMatch(encabezado, /Domain=/i);
  });

  it("la sesión sin uso en 30 minutos ya no abre; leerla renueva el uso como mucho cada minuto", async () => {
    const repo = memoria();
    const persona = usuario();
    repo.usuarios.set(persona.id, persona);
    const tokenHash = hashDeToken(TOKEN);
    const fila: SesionMem = {
      id: randomUUID(),
      userId: persona.id,
      tokenHash,
      expiresAt: new Date(AHORA.getTime() + VIGENCIA_SESION_MS),
      completa: true,
      ultimoUso: new Date(AHORA.getTime() - 30_000),
    };
    repo.sesiones.set(tokenHash, fila);
    const cookie = `${NOMBRE_COOKIE}=${TOKEN}`;

    assert.ok(await leerSesion(cookie, deps(repo)));
    assert.equal(repo.renovaciones.length, 0, "dentro del minuto no escribe");

    fila.ultimoUso = new Date(AHORA.getTime() - RENOVACION_USO_MS - 1);
    assert.ok(await leerSesion(cookie, deps(repo)));
    assert.deepEqual(repo.renovaciones, [AHORA.toISOString()]);
    assert.equal(fila.ultimoUso.getTime(), AHORA.getTime());

    fila.ultimoUso = new Date(AHORA.getTime() - INACTIVIDAD_SESION_MS - 1);
    assert.equal(await leerSesion(cookie, deps(repo)), null);
    assert.equal(repo.renovaciones.length, 1, "la sesión inactiva no se revive");
  });

  it("la base aplica la inactividad: sesion_por_token filtra ultimo_uso y la renovación espera un minuto", () => {
    const migracion = readFileSync(new URL("../../../db/migrations/0025_seguridad_cuentas.sql", import.meta.url), "utf8");
    assert.match(migracion, /s\.ultimo_uso > p_ahora - interval '30 minutes'/);
    assert.equal(INACTIVIDAD_SESION_MS, 30 * 60 * 1000);
    assert.match(SQL.renovarUso, /ultimo_uso < \$3::timestamptz - interval '1 minute'/);
    assert.match(SQL.buscarSesion, /ultimo_uso/);
  });
});

describe("cuenta y sesión", () => {
  it("la sesión parcial no abre portales y la completa sí; cada una se lee con su cookie", async () => {
    const repo = memoria();
    const persona = usuario();
    repo.usuarios.set(persona.id, persona);
    const parcial = "p".repeat(43);
    const completo = "c".repeat(43);
    sembrarSesion(repo, persona.id, parcial, false);
    sembrarSesion(repo, persona.id, completo, true);
    const cookieParcial = `${NOMBRE_COOKIE_PARCIAL}=${parcial}`;
    const cookieCompleta = `${NOMBRE_COOKIE}=${completo}`;
    assert.equal(await leerSesion(cookieParcial, deps(repo)), null);
    assert.equal(await leerSesion(`${NOMBRE_COOKIE}=${parcial}`, deps(repo)), null, "el token parcial no sirve como completo");
    assert.equal((await leerSesionParcial(cookieParcial, deps(repo)))?.segundoFactor, null);
    assert.equal((await leerSesion(cookieCompleta, deps(repo)))?.usuario.correo, "ana@ejemplo.mx");
    assert.equal(await leerSesionParcial(`${NOMBRE_COOKIE_PARCIAL}=${completo}`, deps(repo)), null);
  });

  it("caduca la sesión completa y cerrar solo borra el token presentado", async () => {
    const repo = memoria();
    let ahora = AHORA;
    const dependencias = deps(repo);
    dependencias.ahora = () => ahora;
    repo.usuarios.set("1", usuario());
    repo.usuarios.set("2", { ...usuario(), id: "2", correo: "luis@ejemplo.mx", nombre: "Luis Alma" });
    const ana = `${NOMBRE_COOKIE}=${"c".repeat(43)}`;
    const luis = `${NOMBRE_COOKIE}=${"e".repeat(43)}`;
    sembrarSesion(repo, usuario().id, "c".repeat(43), true);
    sembrarSesion(repo, "2", "e".repeat(43), true);
    ahora = new Date(AHORA.getTime() + VIGENCIA_SESION_MS - 1);
    assert.ok(await leerSesion(ana, dependencias));
    ahora = new Date(AHORA.getTime() + VIGENCIA_SESION_MS);
    assert.equal(await leerSesion(ana, dependencias), null);

    ahora = AHORA;
    const cierre = await cerrarSesion(ana, dependencias);
    assert.match(cierre.setCookies[0], /Max-Age=0/);
    assert.equal(await leerSesion(ana, dependencias), null);
    assert.equal((await leerSesion(luis, dependencias))?.usuario.correo, "luis@ejemplo.mx");
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

function sembrarSesion(repo: ReturnType<typeof memoria>, userId: string, token: string, completa: boolean): void {
  const tokenHash = hashDeToken(token);
  repo.sesiones.set(tokenHash, { id: randomUUID(), userId, tokenHash, expiresAt: new Date(AHORA.getTime() + VIGENCIA_SESION_MS), completa });
}

type SesionMem = { id: string; userId: string; tokenHash: string; expiresAt: Date; completa: boolean; ultimoUso?: Date };

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
  renovaciones: string[];
} {
  const usuarios = new Map<string, UsuarioInterno>();
  const sesiones = new Map<string, SesionMem>();
  const fallos: Array<string | null> = [];
  const renovaciones: string[] = [];
  function aSesion(fila: SesionMem) {
    const persona = [...usuarios.values()].find((actual) => actual.id === fila.userId);
    if (!persona) return null;
    return {
      id: fila.id,
      venceEn: fila.expiresAt,
      usuario: { id: persona.id, nombre: persona.nombre, correo: persona.correo },
      segundoFactor: fila.completa ? { metodo: "totp" as const, en: AHORA } : null,
      ...(fila.ultimoUso ? { ultimoUsoEn: fila.ultimoUso } : {}),
    };
  }
  return {
    usuarios,
    sesiones,
    fallos,
    renovaciones,
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
      if (fila.ultimoUso && fila.ultimoUso.getTime() <= ahora.getTime() - INACTIVIDAD_SESION_MS) return null;
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
    async renovarUso(sesionId, userId, ahora) {
      const fila = [...sesiones.values()].find((actual) => actual.id === sesionId && actual.userId === userId);
      if (fila?.ultimoUso && fila.ultimoUso.getTime() < ahora.getTime() - RENOVACION_USO_MS) {
        fila.ultimoUso = ahora;
        renovaciones.push(ahora.toISOString());
      }
    },
  };
}

function archivosTs(dir: string): string[] {
  return readdirSync(dir)
    .filter((nombre) => nombre.endsWith(".ts") && !nombre.endsWith(".test.ts"))
    .map((nombre) => join(dir, nombre));
}
