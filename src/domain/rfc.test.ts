import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  validarCodigoPostal,
  validarRfc,
  validarRfcDeAlta,
  type ErrorDeCodigoPostal,
  type ErrorDeRfc,
} from "./rfc.ts";

function exigeRfc(entrada: unknown, rfc: string, tipo: "moral" | "fisica") {
  assert.deepEqual(validarRfc(entrada), { ok: true, rfc, tipo });
}

function exigeErrorRfc(entrada: unknown, error: ErrorDeRfc) {
  assert.deepEqual(validarRfc(entrada), { ok: false, error });
}

function exigeCp(entrada: unknown, codigoPostal: string) {
  assert.deepEqual(validarCodigoPostal(entrada), { ok: true, codigoPostal });
}

function exigeErrorCp(entrada: unknown, error: ErrorDeCodigoPostal) {
  assert.deepEqual(validarCodigoPostal(entrada), { ok: false, error });
}

describe("validarRfc", () => {
  it("acepta persona moral de 12 con el patrón del SAT", () => {
    exigeRfc("PAL7202161U0", "PAL7202161U0", "moral");
    exigeRfc("EKU9003173C9", "EKU9003173C9", "moral");
    exigeRfc("H&E951128469", "H&E951128469", "moral");
  });

  it("acepta 13 caracteres porque la fase 1 admite persona física", () => {
    exigeRfc("CABL840215RF4", "CABL840215RF4", "fisica");
    exigeRfc("XAXX010101000", "XAXX010101000", "fisica");
    exigeRfc("XEXX010101000", "XEXX010101000", "fisica");
  });

  it("normaliza espacios y mayúsculas, incluida la Ñ", () => {
    exigeRfc("  pal7202161u0  ", "PAL7202161U0", "moral");
    exigeRfc("cabl840215rf4", "CABL840215RF4", "fisica");
    exigeRfc("oño120726rx3", "OÑO120726RX3", "moral");
  });

  it("cuenta caracteres y no bytes cuando hay Ñ", () => {
    const rfc = "ÑAB800101XX1";
    assert.equal(rfc.length, 12);
    assert.equal(Buffer.byteLength(rfc), 13);
    exigeRfc(rfc, rfc, "moral");
  });

  it("acepta la homoclave que termina en A y los bordes de mes y día", () => {
    exigeRfc("PAL7202161UA", "PAL7202161UA", "moral");
    exigeRfc("PAL7201161U0", "PAL7201161U0", "moral");
    exigeRfc("PAL7212161U0", "PAL7212161U0", "moral");
    exigeRfc("PAL7202011U0", "PAL7202011U0", "moral");
    exigeRfc("PAL7201311U0", "PAL7201311U0", "moral");
  });

  it("acepta el 31 de febrero porque t_RFC no cruza día y mes", () => {
    exigeRfc("PAL7202311U0", "PAL7202311U0", "moral");
  });

  it("rechaza vacío, longitud distinta de 12 o 13, y patrón imposible", () => {
    const casos: Array<[unknown, ErrorDeRfc]> = [
      [undefined, "rfc_requerido"],
      [null, "rfc_requerido"],
      [720216, "rfc_requerido"],
      ["", "rfc_requerido"],
      ["   ", "rfc_requerido"],
      ["PAL7202161U", "rfc_longitud"],
      ["PAL7202161U0XX", "rfc_longitud"],
      ["PAL7202161U0X", "rfc_patron"],
      ["PAL7213161U0", "rfc_patron"],
      ["PAL7200161U0", "rfc_patron"],
      ["PAL7202001U0", "rfc_patron"],
      ["PAL7202321U0", "rfc_patron"],
      ["PAL7202161UB", "rfc_patron"],
      ["PAL720216 1U0", "rfc_patron"],
      ["ÁBC010101AB1", "rfc_patron"],
      ["ABCD011301AB1", "rfc_patron"],
      ["CABL840215RFB", "rfc_patron"],
    ];

    for (const [entrada, error] of casos) {
      exigeErrorRfc(entrada, error);
    }
  });
});

describe("validarRfcDeAlta", () => {
  it("usa el patrón de la fase, el mismo que el CHECK, sin dígito ni cruce de fecha", () => {
    const sql = readFileSync(new URL("../../db/migrations/0001_companies.sql", import.meta.url), "utf8");
    assert.match(sql, /char_length\(rfc\) IN \(12, 13\)/);
    assert.match(sql, /\[A-Z&Ñ\]\{3\}/);
    assert.match(sql, /\[A-Z&Ñ\]\{4\}/);
    assert.match(sql, /\[A-Z0-9\]\{2\}\[0-9A\]/);

    assert.deepEqual(validarRfcDeAlta(" tcm-010101-ab1 "), {
      ok: true,
      rfc: "TCM010101AB1",
      tipo: "moral",
    });
    assert.equal(validarRfcDeAlta("PAL7202311U0").ok, true);
    assert.equal(validarRfcDeAlta("EKU9003173C9").ok, true);
    assert.equal(validarRfc("XAXX010101000").ok, true);
    assert.equal(validarRfcDeAlta("XAXX010101000").ok, false);
    assert.equal(validarRfcDeAlta("xexx-010101-000").ok, false);
    if (!validarRfcDeAlta("XAXX010101000").ok) {
      assert.equal(validarRfcDeAlta("XAXX010101000").error, "generico");
    }
  });
});

describe("validarCodigoPostal", () => {
  it("acepta cinco dígitos y conserva el cero a la izquierda", () => {
    exigeCp("01000", "01000");
    exigeCp("06600", "06600");
    exigeCp("44100", "44100");
    exigeCp("00000", "00000");
    exigeCp("  64000\n", "64000");
  });

  it("rechaza vacío y lo que no son cinco dígitos", () => {
    const casos: Array<[unknown, ErrorDeCodigoPostal]> = [
      [undefined, "codigo_postal_requerido"],
      [null, "codigo_postal_requerido"],
      [1000, "codigo_postal_requerido"],
      ["", "codigo_postal_requerido"],
      ["   ", "codigo_postal_requerido"],
      ["4410", "codigo_postal_patron"],
      ["441000", "codigo_postal_patron"],
      ["4410A", "codigo_postal_patron"],
      ["44 100", "codigo_postal_patron"],
      ["+44100", "codigo_postal_patron"],
    ];

    for (const [entrada, error] of casos) {
      exigeErrorCp(entrada, error);
    }
  });
});
