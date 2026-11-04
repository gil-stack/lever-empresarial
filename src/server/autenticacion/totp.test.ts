import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cifrarSemilla, descifrarSemilla, llaveDesde } from "./cifrado";
import { destinoSeguro } from "./destino";
import { dominiosDesdeEntorno } from "./entorno";
import { origenDe } from "./origen";
import { hashDeRespaldo, normalizarRespaldo } from "./respaldo";
import { aBase32, codigoDelPaso, deBase32, pasoDe, semillaLegible, uriOtpauth, verificarTotp } from "./totp";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

const SEMILLA = Buffer.from("12345678901234567890");
const LLAVE = Buffer.alloc(32, 9);

describe("totp", () => {
  it("reproduce el vector SHA1 del RFC 6238", () => {
    assert.equal(codigoDelPaso(SEMILLA, 1, 8), "94287082");
    assert.equal(codigoDelPaso(SEMILLA, 1), "287082");
    assert.equal(pasoDe(new Date(59_000)), 1);
    const ahora = new Date(59_000);
    assert.equal(verificarTotp(SEMILLA, "287082", ahora, null), 1);
    assert.equal(verificarTotp(SEMILLA, "287082", ahora, 1), null);
    assert.equal(verificarTotp(SEMILLA, "000000", ahora, null), null);
  });

  it("la semilla legible vuelve a ser la misma", () => {
    const ida = aBase32(SEMILLA);
    assert.deepEqual(deBase32(semillaLegible(SEMILLA)), SEMILLA);
    assert.equal(deBase32(ida).equals(SEMILLA), true);
    assert.match(uriOtpauth("Arco", "ana@ejemplo.mx", SEMILLA), /^otpauth:\/\/totp\/Arco/);
    assert.equal(uriOtpauth("Arco", "ana@ejemplo.mx", SEMILLA).includes("algorithm=SHA1"), true);
  });
});

describe("cifrado de la semilla", () => {
  it("descifra para la misma persona y no para otra", () => {
    const cifrado = cifrarSemilla(SEMILLA, "persona-a", LLAVE);
    assert.equal(descifrarSemilla(cifrado, "persona-a", LLAVE).equals(SEMILLA), true);
    assert.throws(() => descifrarSemilla(cifrado, "persona-b", LLAVE), (error: unknown) => {
      return error instanceof ErrorDeDominio && error.codigo === "totp_no_disponible";
    });
    assert.match(cifrado, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,200}\.[A-Za-z0-9_-]{22}$/);
    assert.equal(cifrado.includes(aBase32(SEMILLA)), false);
    assert.equal(llaveDesde(LLAVE.toString("base64url"))?.equals(LLAVE), true);
    assert.equal(llaveDesde("corta"), null);
  });
});

describe("respaldo y origen", () => {
  it("normaliza el código y no guarda el texto", () => {
    const normalizado = normalizarRespaldo("abcd-efgh-jklm-npqr");
    assert.equal(normalizado, "ABCDEFGHJKLMNPQR");
    assert.equal(normalizarRespaldo("0000-0000-0000-0000"), null);
    const hash = hashDeRespaldo(normalizado!);
    assert.equal(hash.length, 64);
    assert.equal(hash.includes("ABCD"), false);
  });

  it("solo acepta un dominio de la lista y un destino conocido", () => {
    assert.deepEqual(origenDe("localhost:3000", "http", new Set(["localhost"])), {
      rpID: "localhost",
      origen: "http://localhost:3000",
    });
    assert.throws(() => origenDe("otro.ejemplo", "https", new Set(["arco.mx"])), (error: unknown) => {
      return error instanceof ErrorDeDominio && error.codigo === "origen_no_permitido";
    });
    assert.equal(destinoSeguro("/telefono"), "/telefono");
    assert.equal(destinoSeguro("https://otro.ejemplo"), "/consola");
    assert.equal(dominiosDesdeEntorno({ NODE_ENV: "production", VERCEL_URL: "https://arco.vercel.app" }).has("arco.vercel.app"), true);
    assert.equal(dominiosDesdeEntorno({ NODE_ENV: "production" }).has("localhost"), false);
  });
});
