import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ErrorDeCorreo } from "../correo/errores.ts";
import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import { hashDeToken } from "../session/hash.ts";
import type { Sesion } from "../session/tipos.ts";
import { registrarHechoAcceso } from "./auditar.ts";
import { contextoDeSistema, contextoDesdeSesion } from "./contexto.ts";
import { ADMIN, buzon, EMPRESA, memoria, tokenDe } from "./memoria.test-util.ts";
import { aceptarInvitacion, invitarEmpresa, invitarUsuario, leerInvitacion, revocarInvitacion } from "./servicio.ts";
import { VIGENCIA_INVITACION_MS } from "./token.ts";

const AHORA = new Date("2026-11-04T16:00:00.000Z");
const CLAVE = "clave-de-luis-77";

const SESION_ADMIN: Sesion = {
  id: "s",
  venceEn: AHORA,
  usuario: { id: ADMIN, nombre: "Ana Pérez", correo: "ana@ejemplo.mx" },
  companyId: EMPRESA,
  rol: "administrador",
};

function armar(opciones: Parameters<typeof memoria>[0] = {}) {
  const repo = memoria(opciones);
  const correo = buzon();
  let ahora = AHORA;
  let siguiente = 0;
  const pasos: Array<{ userId: string; cuentaNueva: boolean }> = [];
  const deps = {
    repositorio: repo.invitaciones,
    enviador: correo.enviador,
    urlBase: "https://app.ejemplo.mx",
    ahora: () => ahora,
    token: () => `${String.fromCharCode(97 + (siguiente++ % 26))}`.repeat(43),
    hashear: async (c: string) => `hash:${c}`,
    verificar: async (c: string, h: string) => h === `hash:${c}`,
    segundoFactor: async ({ userId, cuentaNueva }: { userId: string; cuentaNueva: boolean }) => {
      pasos.push({ userId, cuentaNueva });
      return {
        setCookie: `sesion=${"z".repeat(43)}; HttpOnly`,
        destino: cuentaNueva ? "/segundo-factor/registrar" : "/segundo-factor/verificar",
      };
    },
  };
  return {
    repo,
    correo,
    deps,
    pasos,
    avanzar(ms: number) {
      ahora = new Date(ahora.getTime() + ms);
    },
  };
}

const LUIS = { correo: "  Luis@Ejemplo.MX ", nombre: " Luis  Alma ", roles: ["liberador"] };

describe("invitar a una persona", () => {
  it("solo la administración de la empresa de la sesión invita", async () => {
    const { deps, repo } = armar();
    for (const rol of ["liberador", "contador", "tarjetahabiente", "solicitante"] as const) {
      const contexto = contextoDesdeSesion({ ...SESION_ADMIN, rol });
      assert.equal(await codigo(invitarUsuario(contexto, LUIS, deps)), "sin_permiso");
    }
    assert.equal(await codigo(invitarUsuario(contextoDesdeSesion(null), LUIS, deps)), "sin_permiso");
    assert.equal(
      await codigo(invitarUsuario(contextoDesdeSesion({ ...SESION_ADMIN, companyId: null }), LUIS, deps)),
      "sin_permiso",
    );
    assert.equal(repo.estado.invitaciones.size, 0);
  });

  it("sin RESEND_API_KEY ni CORREO_REMITENTE no escribe la base y lo dice", async () => {
    const { deps, repo } = armar();
    const sinCorreo = { ...deps, enviador: undefined };
    const previo = { clave: process.env.RESEND_API_KEY, remitente: process.env.CORREO_REMITENTE };
    delete process.env.RESEND_API_KEY;
    delete process.env.CORREO_REMITENTE;
    try {
      const error = await capturar(invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, sinCorreo));
      assert.ok(error instanceof ErrorDeCorreo);
      assert.equal(error.codigo, "correo_no_configurado");
      assert.deepEqual([...error.faltan], ["RESEND_API_KEY", "CORREO_REMITENTE"]);
    } finally {
      if (previo.clave !== undefined) process.env.RESEND_API_KEY = previo.clave;
      if (previo.remitente !== undefined) process.env.CORREO_REMITENTE = previo.remitente;
    }
    assert.equal(repo.estado.invitaciones.size, 0);
    assert.equal(repo.estado.auditoria.length, 0);
  });

  it("guarda el hash del token, nunca el token, y el enlace solo viaja en el correo", async () => {
    const { deps, repo, correo } = armar();
    const enviada = await invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, deps);
    assert.equal(enviada.venceEn.getTime(), AHORA.getTime() + VIGENCIA_INVITACION_MS);
    assert.equal(JSON.stringify(enviada).includes("a".repeat(43)), false);

    const guardada = repo.estado.invitaciones.get(enviada.invitacionId);
    assert.ok(guardada);
    assert.equal(guardada.correo, "luis@ejemplo.mx");
    assert.equal(guardada.nombre, "Luis Alma");
    assert.deepEqual(guardada.roles, ["liberador"]);
    assert.equal(guardada.invitadoPor, ADMIN);
    const token = tokenDe(correo.enviados[0], "invitacion");
    assert.equal(guardada.tokenHash, hashDeToken(token));
    assert.equal(JSON.stringify([...repo.estado.invitaciones.values()]).includes(token), false);

    assert.equal(correo.enviados.length, 1);
    assert.equal(correo.enviados[0].para, "luis@ejemplo.mx");
    assert.equal(correo.enviados[0].idempotencia, `invitacion/${enviada.invitacionId}`);
    assert.equal(correo.enviados[0].asunto, "Ana Pérez te invitó a Talleres del Norte");
    assert.deepEqual(
      repo.estado.auditoria.map((h) => [h.accion, h.entidad, h.companyId, h.actorId, h.identificador]),
      [["invitacion_creada", "invitations", EMPRESA, ADMIN, enviada.invitacionId]],
    );
  });

  it("reenviar revoca la invitación anterior: el enlace viejo ya no sirve", async () => {
    const { deps, repo, correo } = armar();
    const contexto = contextoDesdeSesion(SESION_ADMIN);
    const primera = await invitarUsuario(contexto, LUIS, deps);
    const segunda = await invitarUsuario(contexto, LUIS, deps);
    assert.ok(repo.estado.invitaciones.get(primera.invitacionId)?.revocadaEn);
    assert.equal(repo.estado.invitaciones.get(segunda.invitacionId)?.revocadaEn, null);
    assert.deepEqual(await leerInvitacion(tokenDe(correo.enviados[0], "invitacion"), deps), { estado: "no_valida" });
    assert.equal((await leerInvitacion(tokenDe(correo.enviados[1], "invitacion"), deps)).estado, "vigente");
    assert.deepEqual(
      repo.estado.auditoria.map((h) => h.accion),
      ["invitacion_creada", "invitacion_revocada", "invitacion_creada"],
    );
  });

  it("valida correo, nombre y roles, y no invita a quien ya es miembro", async () => {
    const { deps, repo } = armar();
    const contexto = contextoDesdeSesion(SESION_ADMIN);
    assert.equal(await codigo(invitarUsuario(contexto, { ...LUIS, correo: "no-es" }, deps)), "correo_invalido");
    assert.equal(await codigo(invitarUsuario(contexto, { ...LUIS, nombre: " " }, deps)), "nombre_invalido");
    assert.equal(await codigo(invitarUsuario(contexto, { ...LUIS, roles: [] }, deps)), "roles_invalidos");
    assert.equal(await codigo(invitarUsuario(contexto, { ...LUIS, roles: ["dueno"] }, deps)), "roles_invalidos");
    assert.equal(await codigo(invitarUsuario(contexto, { ...LUIS, correo: "ANA@ejemplo.mx" }, deps)), "ya_es_miembro");
    assert.equal(repo.estado.invitaciones.size, 0);
  });

  it("los roles combinados esperan a la tenencia", async () => {
    const roles = ["liberador", "tarjetahabiente"];
    const hoy = armar();
    assert.equal(
      await codigo(invitarUsuario(contextoDesdeSesion(SESION_ADMIN), { ...LUIS, roles }, hoy.deps)),
      "roles_combinados_pendientes",
    );
    const conTenencia = armar({ rolesCombinables: true });
    const enviada = await invitarUsuario(contextoDesdeSesion(SESION_ADMIN), { ...LUIS, roles }, conTenencia.deps);
    assert.deepEqual(conTenencia.repo.estado.invitaciones.get(enviada.invitacionId)?.roles, roles);
  });

  it("si el proveedor rechaza el correo, la invitación queda revocada y el error dice por qué", async () => {
    const { deps, repo } = armar();
    const error = await capturar(
      invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, {
        ...deps,
        enviador: async () => {
          throw new ErrorDeCorreo("correo_rechazado");
        },
      }),
    );
    assert.ok(error instanceof ErrorDeCorreo);
    assert.equal(error.codigo, "correo_rechazado");
    const [unica] = [...repo.estado.invitaciones.values()];
    assert.ok(unica.revocadaEn);
    assert.deepEqual(
      repo.estado.auditoria.map((h) => h.accion),
      ["invitacion_creada", "invitacion_revocada"],
    );
  });

  it("revocar: solo una pendiente de la propia empresa", async () => {
    const { deps, repo, correo } = armar();
    const contexto = contextoDesdeSesion(SESION_ADMIN);
    const enviada = await invitarUsuario(contexto, LUIS, deps);
    await revocarInvitacion(contexto, enviada.invitacionId, deps);
    assert.ok(repo.estado.invitaciones.get(enviada.invitacionId)?.revocadaEn);
    assert.equal(await codigo(revocarInvitacion(contexto, enviada.invitacionId, deps)), "invitacion_no_valida");
    assert.equal(
      await codigo(revocarInvitacion(contextoDesdeSesion({ ...SESION_ADMIN, rol: "contador" }), enviada.invitacionId, deps)),
      "sin_permiso",
    );
    assert.equal(
      await codigo(aceptarInvitacion({ token: tokenDe(correo.enviados[0], "invitacion"), contrasena: CLAVE, confirmacion: CLAVE }, deps)),
      "invitacion_no_valida",
    );
  });
});

describe("invitar a una empresa", () => {
  it("solo el comando del personal; la persona entra como administradora", async () => {
    const { deps, repo, correo } = armar();
    const datos = { companyId: EMPRESA, correo: "duena@ejemplo.mx", nombre: "Dueña Uno" };
    assert.equal(await codigo(invitarEmpresa(contextoDesdeSesion(SESION_ADMIN), datos, deps)), "sin_permiso");
    assert.equal(
      await codigo(invitarEmpresa(contextoDeSistema(), { ...datos, companyId: "no-uuid" }, deps)),
      "empresa_ausente",
    );
    assert.equal(
      await codigo(
        invitarEmpresa(contextoDeSistema(), { ...datos, companyId: "11111111-1111-4111-8111-111111111111" }, deps),
      ),
      "empresa_ausente",
    );
    const enviada = await invitarEmpresa(contextoDeSistema(), datos, deps);
    const guardada = repo.estado.invitaciones.get(enviada.invitacionId);
    assert.equal(guardada?.tipo, "empresa");
    assert.deepEqual(guardada?.roles, ["administrador"]);
    assert.equal(guardada?.invitadoPor, null);
    assert.equal(correo.enviados[0].asunto, "Tu acceso a Talleres del Norte");
    assert.match(correo.enviados[0].texto, /TNO010101AB1/);
    assert.equal(repo.estado.auditoria[0].actorId, null);
    assert.equal(repo.estado.auditoria[0].companyId, EMPRESA);
  });
});

describe("aceptar una invitación", () => {
  it("abrir el enlace no lo gasta; la persona elige su contraseña, sigue a registrar su segundo factor, y el enlace muere", async () => {
    const { deps, repo, correo, pasos } = armar();
    const enviada = await invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, deps);
    const token = tokenDe(correo.enviados[0], "invitacion");

    const lectura = await leerInvitacion(token, deps);
    assert.equal(lectura.estado, "vigente");
    if (lectura.estado !== "vigente") return;
    assert.equal(lectura.razonSocial, "Talleres del Norte");
    assert.equal(lectura.quienInvita, "Ana Pérez");
    assert.equal(lectura.cuentaExistente, false);
    assert.equal((await leerInvitacion(token, deps)).estado, "vigente");

    assert.equal(await codigo(aceptarInvitacion({ token, contrasena: "corta", confirmacion: "corta" }, deps)), "contrasena_invalida");
    assert.equal(
      await codigo(aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: `${CLAVE}x` }, deps)),
      "contrasenas_distintas",
    );
    assert.equal(repo.estado.invitaciones.get(enviada.invitacionId)?.aceptadaEn, null);

    const aceptada = await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE }, deps);
    assert.equal(aceptada.cuentaNueva, true);
    assert.equal(aceptada.siguiente?.destino, "/segundo-factor/registrar");
    const luis = [...repo.estado.usuarios.values()].find((u) => u.correo === "luis@ejemplo.mx");
    assert.ok(luis);
    assert.equal(luis.passwordHash, `hash:${CLAVE}`);
    assert.equal(luis.nombre, "Luis Alma");
    assert.deepEqual(luis.verificadoEn, AHORA);
    assert.deepEqual(pasos, [{ userId: luis.id, cuentaNueva: true }]);
    assert.deepEqual(
      repo.estado.membresias.find((m) => m.userId === luis.id),
      { userId: luis.id, companyId: EMPRESA, roles: ["liberador"] },
    );
    const fila = repo.estado.invitaciones.get(enviada.invitacionId);
    assert.deepEqual(fila?.aceptadaEn, AHORA);
    assert.equal(fila?.aceptadaPor, luis.id);
    assert.deepEqual(repo.estado.auditoria.at(-1), {
      companyId: EMPRESA,
      actorId: luis.id,
      accion: "invitacion_aceptada",
      entidad: "invitations",
      identificador: enviada.invitacionId,
      ocurridoEn: AHORA,
    });

    assert.deepEqual(await leerInvitacion(token, deps), { estado: "no_valida" });
    assert.equal(
      await codigo(aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE }, deps)),
      "invitacion_no_valida",
    );
    assert.equal([...repo.estado.usuarios.values()].filter((u) => u.correo === "luis@ejemplo.mx").length, 1);
  });

  it("vence: pasado el plazo no sirve, aunque nadie la haya usado", async () => {
    const { deps, correo, avanzar } = armar();
    await invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, deps);
    const token = tokenDe(correo.enviados[0], "invitacion");
    avanzar(VIGENCIA_INVITACION_MS - 1);
    assert.equal((await leerInvitacion(token, deps)).estado, "vigente");
    avanzar(1);
    assert.deepEqual(await leerInvitacion(token, deps), { estado: "vencida" });
    assert.equal(
      await codigo(aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE }, deps)),
      "invitacion_vencida",
    );
  });

  it("con cuenta existente pide su contraseña y no la cambia", async () => {
    const { deps, repo, correo } = armar();
    const otra = "22222222-2222-4222-8222-222222222222";
    repo.estado.usuarios.set(otra, {
      id: otra,
      nombre: "Luis Alma",
      correo: "luis@ejemplo.mx",
      passwordHash: "hash:la-de-siempre-1",
      verificadoEn: null,
    });
    await invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, deps);
    const token = tokenDe(correo.enviados[0], "invitacion");
    const lectura = await leerInvitacion(token, deps);
    assert.equal(lectura.estado === "vigente" && lectura.cuentaExistente, true);

    assert.equal(await codigo(aceptarInvitacion({ token, contrasena: CLAVE }, deps)), "credenciales_invalidas");
    assert.equal(await codigo(aceptarInvitacion({ token }, deps)), "credenciales_invalidas");
    assert.equal((await leerInvitacion(token, deps)).estado, "vigente");

    const aceptada = await aceptarInvitacion({ token, contrasena: "la-de-siempre-1" }, deps);
    assert.equal(aceptada.cuentaNueva, false);
    assert.equal(aceptada.siguiente?.destino, "/segundo-factor/verificar");
    assert.equal(repo.estado.usuarios.get(otra)?.passwordHash, "hash:la-de-siempre-1");
    assert.equal(repo.estado.usuarios.size, 2);
    assert.ok(repo.estado.membresias.some((m) => m.userId === otra && m.companyId === EMPRESA));
  });

  it("sin la autenticación, aceptar guarda la contraseña y no abre ninguna sesión", async () => {
    const { deps, repo, correo } = armar();
    await invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, deps);
    const token = tokenDe(correo.enviados[0], "invitacion");
    const aceptada = await aceptarInvitacion(
      { token, contrasena: CLAVE, confirmacion: CLAVE },
      { ...deps, segundoFactor: undefined },
    );
    assert.deepEqual(aceptada, { cuentaNueva: true, siguiente: null });
    assert.ok([...repo.estado.usuarios.values()].some((u) => u.correo === "luis@ejemplo.mx"));
  });

  it("el paso del segundo factor no redirige fuera, y si falla no hay sesión pero la aceptación queda", async () => {
    for (const salida of [
      async () => ({ setCookie: "sesion=x", destino: "https://otro.sitio/robar" }),
      async () => ({ setCookie: "sesion=x", destino: "//otro.sitio" }),
      async () => {
        throw new Error("autenticación caída");
      },
    ]) {
      const { deps, repo, correo } = armar();
      await invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, deps);
      const token = tokenDe(correo.enviados[0], "invitacion");
      const aceptada = await aceptarInvitacion(
        { token, contrasena: CLAVE, confirmacion: CLAVE },
        { ...deps, segundoFactor: salida },
      );
      assert.equal(aceptada.siguiente, null);
      assert.ok([...repo.estado.invitaciones.values()][0].aceptadaEn);
    }
  });

  it("si la membresía no entra, nada queda: ni la cuenta ni el token gastado", async () => {
    const { deps, repo, correo } = armar({ unirFalla: true });
    await invitarUsuario(contextoDesdeSesion(SESION_ADMIN), LUIS, deps);
    const token = tokenDe(correo.enviados[0], "invitacion");
    assert.equal(
      await codigo(aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE }, deps)),
      "segunda_razon_social",
    );
    assert.equal([...repo.estado.usuarios.values()].some((u) => u.correo === "luis@ejemplo.mx"), false);
    assert.equal((await leerInvitacion(token, deps)).estado, "vigente");
  });

  it("un token sin forma ni siquiera consulta la base", async () => {
    const { deps } = armar();
    let consultas = 0;
    const repositorio = {
      ...deps.repositorio,
      buscarPorTokenHash: async () => {
        consultas += 1;
        return null;
      },
    };
    for (const malo of ["", "abc", "a".repeat(44), `${"a".repeat(42)}!`, null, 7]) {
      assert.deepEqual(await leerInvitacion(malo, { ...deps, repositorio }), { estado: "no_valida" });
      assert.equal(await codigo(aceptarInvitacion({ token: malo }, { ...deps, repositorio })), "invitacion_no_valida");
    }
    assert.equal(consultas, 0);
  });
});

describe("auditoría de acceso", () => {
  it("seis claves, pares fijos y sin secretos", async () => {
    const llamadas: unknown[][] = [];
    const consulta = { query: async (_sql: string, params: readonly unknown[]) => void llamadas.push([...params]) };
    await registrarHechoAcceso(
      {
        companyId: null,
        actorId: null,
        accion: "recuperacion_solicitada",
        entidad: "password_resets",
        identificador: EMPRESA,
        ocurridoEn: AHORA,
      },
      consulta,
    );
    assert.deepEqual(llamadas[0].slice(1), [null, null, "recuperacion_solicitada", "password_resets", EMPRESA, AHORA]);
    const malos: Array<Record<string, unknown>> = [
      { entidad: "users" },
      { accion: "otra" },
      { identificador: "token-plano" },
      { actorId: "$2b$12$abcdefghijklmnopqrstuv" },
      { token: "x" },
    ];
    for (const parcial of malos) {
      await assert.rejects(
        registrarHechoAcceso(
          {
            companyId: EMPRESA,
            actorId: ADMIN,
            accion: "invitacion_creada",
            entidad: "invitations",
            identificador: EMPRESA,
            ocurridoEn: AHORA,
            ...parcial,
          } as never,
          consulta,
        ),
        /Auditoría rechazada/,
      );
    }
    assert.equal(llamadas.length, 1);
  });
});

describe("el módulo no imprime ni lee el entorno", () => {
  it("sin consola, sin process.env y sin SQL de migración", () => {
    const raiz = dirname(fileURLToPath(import.meta.url));
    const archivos = readdirSync(raiz)
      .filter((n) => n.endsWith(".ts") && !n.includes(".test"))
      .map((n) => join(raiz, n));
    assert.ok(archivos.length >= 9);
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8");
      assert.doesNotMatch(fuente, /\bconsole\b/);
      assert.doesNotMatch(fuente, /process\.(env|stdout|stderr)/);
      assert.doesNotMatch(fuente, /create table|alter table/i);
    }
  });
});

async function codigo(promesa: Promise<unknown>): Promise<string> {
  const error = await capturar(promesa);
  if (error instanceof ErrorDeDominio) return error.codigo;
  throw error;
}

async function capturar(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error("la operación no rechazó");
}
