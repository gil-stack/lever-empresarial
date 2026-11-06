import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatoPesos, formatoPesosGrande, leerCentavosEscritos } from "./centavos.ts";

describe("centavos escritos por la empresa", () => {
  it("el vacío no es cero", () => {
    assert.deepEqual(leerCentavosEscritos(""), { tipo: "vacio" });
    assert.deepEqual(leerCentavosEscritos("   "), { tipo: "vacio" });
    assert.deepEqual(leerCentavosEscritos("0"), { tipo: "centavos", centavos: 0 });
    assert.deepEqual(leerCentavosEscritos("0.00"), { tipo: "centavos", centavos: 0 });
    assert.deepEqual(leerCentavosEscritos("0,00"), { tipo: "centavos", centavos: 0 });
  });

  it("un centavo se guarda como un centavo", () => {
    assert.deepEqual(leerCentavosEscritos("0.01"), { tipo: "centavos", centavos: 1 });
    assert.deepEqual(leerCentavosEscritos("0,01"), { tipo: "centavos", centavos: 1 });
    assert.deepEqual(leerCentavosEscritos("$0.01"), { tipo: "centavos", centavos: 1 });
  });

  it("acepta el peso con separadores de México y el decimal al final", () => {
    assert.deepEqual(leerCentavosEscritos("1"), { tipo: "centavos", centavos: 100 });
    assert.deepEqual(leerCentavosEscritos("1.5"), { tipo: "centavos", centavos: 150 });
    assert.deepEqual(leerCentavosEscritos("1.50"), { tipo: "centavos", centavos: 150 });
    assert.deepEqual(leerCentavosEscritos("12,50"), { tipo: "centavos", centavos: 1250 });
    assert.deepEqual(leerCentavosEscritos("1,234.56"), { tipo: "centavos", centavos: 123456 });
    assert.deepEqual(leerCentavosEscritos("1.234,56"), { tipo: "centavos", centavos: 123456 });
    assert.deepEqual(leerCentavosEscritos("$1,234.56"), { tipo: "centavos", centavos: 123456 });
    assert.deepEqual(leerCentavosEscritos("1,234"), { tipo: "centavos", centavos: 123400 });
    assert.deepEqual(leerCentavosEscritos("1.234"), { tipo: "centavos", centavos: 123400 });
  });

  it("rechaza un tercer decimal, un signo y lo que no es un monto", () => {
    assert.equal(leerCentavosEscritos("0.001").tipo, "invalido");
    assert.equal(leerCentavosEscritos("1.2345").tipo, "invalido");
    assert.equal(leerCentavosEscritos("-1").tipo, "invalido");
    assert.equal(leerCentavosEscritos("1.").tipo, "invalido");
    assert.equal(leerCentavosEscritos("mil").tipo, "invalido");
    assert.equal(leerCentavosEscritos(100).tipo, "invalido");
  });

  it("el formato de México muestra los centavos y da la vuelta", () => {
    assert.equal(formatoPesos(0), "$0.00");
    assert.equal(formatoPesos(1), "$0.01");
    assert.equal(formatoPesos(100), "$1.00");
    assert.equal(formatoPesos(123456), "$1,234.56");
    assert.equal(formatoPesos(-150), "-$1.50");
    for (const centavos of [0, 1, 99, 100, 123456]) {
      const leido = leerCentavosEscritos(formatoPesos(centavos));
      assert.deepEqual(leido, { tipo: "centavos", centavos });
    }
  });

  it("una suma mayor que 2^53 centavos se presenta exacta y no rompe la página", () => {
    assert.equal(formatoPesosGrande("0"), "$0.00");
    assert.equal(formatoPesosGrande("123456"), formatoPesos(123456));
    assert.equal(formatoPesosGrande("-150"), "-$1.50");
    assert.equal(formatoPesosGrande("18000000000000000"), "$180,000,000,000,000.00");
    assert.equal(formatoPesosGrande(BigInt("9007199254740993")), "$90,071,992,547,409.93");
    assert.throws(() => formatoPesosGrande("1e20"), /centavos_invalidos/);
  });
});
