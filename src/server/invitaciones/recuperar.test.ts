import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ErrorDeCorreo } from "../correo/errores.ts";
import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import { hashDeToken } from "../session/hash.ts";
import { ADMIN, buzon, memoria, tokenDe } from "./memoria.test-util.ts";
import { leerRecuperacion, restablecerContrasena, solicitarRecuperacion } from "./recuperar.ts";
import { SQL } from "./repositorio.ts";
import { RECUPERACIONES_POR_HORA, VIGENCIA_RECUPERACION_MS } from "./token.ts";

const AHORA = new Date("2026-11-04T16:00:00.000Z");
const NUEVA = "otra-clave-larga-9";

function armar() {
  const repo = memoria();
  const correo = buzon();
  let ahora = AHORA;
  let siguiente = 0;
  const deps = {
    repositorio: repo.recuperacion,
    enviador: correo.enviador,
    urlBase: "https://app.ejemplo.mx",
    ahora: () => ahora,
    token: () => String.fromCharCode(97 + (siguiente++ % 26)).repeat(43),
    hashear: async (c: string) => `hash:${c}`,
  };
  return {
    repo,
    correo,
    deps,
    avanzar(ms: number) {
      ahora = new Date(ahora.getTime() + ms);
    },
  };
}

describe("pedir la recuperación", () => {
  it("sin configuración de correo no escribe la base", async () => {
    const { deps, repo } = armar();
    const sinCorreo = { ...deps, enviador: undefined };
    const previo = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const error = await capturar(solicitarRecuperacion({ correo: "ana@ejemplo.mx" }, sinCorreo));
      assert.ok(error instanceof ErrorDeCorreo);
      assert.equal(error.codigo, "correo_no_configurado");
    } finally {
      if (previo !== undefined) process.env.RESEND_API_KEY = previo;
    }
    assert.equal(repo.estado.recuperaciones.size, 0);
  });

  it("responde igual si el correo no tiene cuenta, sin escribir ni mandar nada", async () => {
    const { deps, repo, correo } = armar();
    await solicitarRecuperacion({ correo: "nadie@ejemplo.mx" }, deps);
    assert.equal(correo.enviados.length, 0);
    assert.equal(repo.estado.recuperaciones.size, 0);
    assert.equal(repo.estado.auditoria.length, 0);
    assert.equal(await codigo(solicitarRecuperacion({ correo: "no-es-correo" }, deps)), "correo_invalido");
  });

  it("manda un enlace de un solo uso, guarda su hash y anula el anterior", async () => {
    const { deps, repo, correo } = armar();
    await solicitarRecuperacion({ correo: " ANA@ejemplo.mx " }, deps);
    await solicitarRecuperacion({ correo: "ana@ejemplo.mx" }, deps);
    assert.equal(correo.enviados.length, 2);
    assert.equal(correo.enviados[0].para, "ana@ejemplo.mx");
    assert.equal(correo.enviados[0].asunto, "Cambia tu contraseña");
    assert.match(correo.enviados[0].idempotencia, /^recuperacion\/[0-9a-f-]{36}$/);
    const primero = tokenDe(correo.enviados[0], "recuperar");
    const segundo = tokenDe(correo.enviados[1], "recuperar");
    const filas = [...repo.estado.recuperaciones.values()];
    assert.deepEqual(filas.map((f) => f.tokenHash), [hashDeToken(primero), hashDeToken(segundo)]);
    assert.equal(JSON.stringify(filas).includes(primero), false);
    assert.equal(filas[0].venceEn.getTime(), AHORA.getTime() + VIGENCIA_RECUPERACION_MS);
    assert.equal(await leerRecuperacion(primero, deps), "no_valida");
    assert.equal(await leerRecuperacion(segundo, deps), "vigente");
    assert.deepEqual(
      repo.estado.auditoria.map((h) => [h.accion, h.companyId, h.actorId]),
      [
        ["recuperacion_solicitada", null, null],
        ["recuperacion_solicitada", null, null],
      ],
    );
  });

  it("pasado el tope por hora deja de mandar sin decirlo", async () => {
    const { deps, correo, avanzar } = armar();
    for (let i = 0; i < RECUPERACIONES_POR_HORA + 2; i += 1) {
      await solicitarRecuperacion({ correo: "ana@ejemplo.mx" }, deps);
    }
    assert.equal(correo.enviados.length, RECUPERACIONES_POR_HORA);
    avanzar(60 * 60 * 1000 + 1);
    await solicitarRecuperacion({ correo: "ana@ejemplo.mx" }, deps);
    assert.equal(correo.enviados.length, RECUPERACIONES_POR_HORA + 1);
  });

  it("si el correo falla, el enlace queda anulado", async () => {
    const { deps, repo } = armar();
    const error = await capturar(
      solicitarRecuperacion(
        { correo: "ana@ejemplo.mx" },
        {
          ...deps,
          enviador: async () => {
            throw new ErrorDeCorreo("correo_limite");
          },
        },
      ),
    );
    assert.ok(error instanceof ErrorDeCorreo);
    assert.equal(error.codigo, "correo_limite");
    assert.ok([...repo.estado.recuperaciones.values()][0].anuladoEn);
  });
});

describe("elegir la contraseña nueva", () => {
  it("cambia el hash, cierra todas las sesiones, deja rastro y el enlace muere", async () => {
    const { deps, repo, correo } = armar();
    await solicitarRecuperacion({ correo: "ana@ejemplo.mx" }, deps);
    const token = tokenDe(correo.enviados[0], "recuperar");

    assert.equal(await codigo(restablecerContrasena({ token, contrasena: "corta", confirmacion: "corta" }, deps)), "contrasena_invalida");
    assert.equal(
      await codigo(restablecerContrasena({ token, contrasena: NUEVA, confirmacion: "otra" }, deps)),
      "contrasenas_distintas",
    );
    assert.equal(await leerRecuperacion(token, deps), "vigente");
    assert.equal(repo.estado.sesiones.size, 1);

    await restablecerContrasena({ token, contrasena: NUEVA, confirmacion: NUEVA }, deps);
    assert.equal(repo.estado.usuarios.get(ADMIN)?.passwordHash, `hash:${NUEVA}`);
    assert.equal(repo.estado.sesiones.size, 0);
    assert.deepEqual(repo.estado.usuarios.get(ADMIN)?.verificadoEn, AHORA);
    assert.deepEqual(repo.estado.auditoria.at(-1), {
      companyId: null,
      actorId: ADMIN,
      accion: "contrasena_restablecida",
      entidad: "users",
      identificador: ADMIN,
      ocurridoEn: AHORA,
    });

    assert.equal(await leerRecuperacion(token, deps), "no_valida");
    assert.equal(
      await codigo(restablecerContrasena({ token, contrasena: "tercera-clave-1", confirmacion: "tercera-clave-1" }, deps)),
      "recuperacion_no_valida",
    );
    assert.equal(repo.estado.usuarios.get(ADMIN)?.passwordHash, `hash:${NUEVA}`);
  });

  it("vence en una hora", async () => {
    const { deps, correo, avanzar } = armar();
    await solicitarRecuperacion({ correo: "ana@ejemplo.mx" }, deps);
    const token = tokenDe(correo.enviados[0], "recuperar");
    avanzar(VIGENCIA_RECUPERACION_MS);
    assert.equal(await leerRecuperacion(token, deps), "vencida");
    assert.equal(
      await codigo(restablecerContrasena({ token, contrasena: NUEVA, confirmacion: NUEVA }, deps)),
      "recuperacion_vencida",
    );
  });

  it("no abre sesión ni toca el segundo factor", async () => {
    const { deps, correo } = armar();
    await solicitarRecuperacion({ correo: "ana@ejemplo.mx" }, deps);
    const token = tokenDe(correo.enviados[0], "recuperar");
    assert.equal(await restablecerContrasena({ token, contrasena: NUEVA, confirmacion: NUEVA }, deps), undefined);

    const fuente = readFileSync(new URL("./recuperar.ts", import.meta.url), "utf8");
    const codigoFuente = fuente.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(codigoFuente, /setCookie|session\/cookie|session\/repositorio|abrirSesion|segundo|factor|totp|passkey|webauthn/i);

    const sentencias = [
      SQL.recuperacionesRecientes,
      SQL.anularRecuperaciones,
      SQL.insertarRecuperacion,
      SQL.anularRecuperacion,
      SQL.consumirRecuperacion,
      SQL.cambiarContrasena,
      SQL.marcarCorreoVerificado,
      SQL.cerrarSesiones,
    ];
    for (const sql of sentencias) {
      const tablas = [...sql.matchAll(/\b(?:from|into|update)\s+([a-z_]+)/gi)].map((m) => m[1]);
      for (const tabla of tablas) assert.ok(["password_resets", "users", "sessions"].includes(tabla), tabla);
      if (/\busers\b/.test(sql)) assert.match(sql, /^update users set (password_hash|correo_verificado_en) = /);
      if (/\bsessions\b/.test(sql)) assert.match(sql, /^delete from sessions where user_id = \$1$/);
    }
  });

  it("un token sin forma no sirve", async () => {
    const { deps } = armar();
    assert.equal(await leerRecuperacion("abc", deps), "no_valida");
    assert.equal(
      await codigo(restablecerContrasena({ token: "abc", contrasena: NUEVA, confirmacion: NUEVA }, deps)),
      "recuperacion_no_valida",
    );
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
