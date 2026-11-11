import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { textoParaSiti } from "./etiquetas";
import { campo41, renglonInusual, sinInicioDeFormula } from "./layout41";
import { pdfDeTexto, winAnsi } from "./pdf";

describe("archivos de PLD", () => {
  it("r2-base-N16: al exportar, un campo que empieza como fórmula lleva un espacio antes; lo demás no cambia", () => {
    for (const inicio of ["=", "+", "-", "@", "\t", "\r"]) {
      assert.equal(sinInicioDeFormula(`${inicio}SUMA(A1)`), ` ${inicio}SUMA(A1)`, JSON.stringify(inicio));
    }
    assert.equal(sinInicioDeFormula("El cliente explicó el pago"), "El cliente explicó el pago");
    assert.equal(sinInicioDeFormula("Peña Núñez, área de operación"), "Peña Núñez, área de operación");
    assert.equal(sinInicioDeFormula(""), "");
    // En el layout de 41 columnas: el «;» se vuelve espacio, todo va en mayúsculas y el inicio de fórmula se neutraliza.
    assert.equal(campo41('=HYPERLINK("http://x";"ver")'), ' =HYPERLINK("HTTP://X" "VER")');
    assert.equal(campo41("- El cliente explicó la operación"), " - EL CLIENTE EXPLICÓ LA OPERACIÓN");
    assert.equal(campo41("\t@suma"), " @SUMA");
    assert.equal(campo41("El cliente explicó la operación"), "EL CLIENTE EXPLICÓ LA OPERACIÓN");
    const renglon = renglonInusual({
      tipo: "3", periodo: "20261110", folio: 1, organoSupervisor: "001002", claveEntidad: "123456",
      descripcion: "+ Pagos repetidos", razones: "=HIPERVINCULO(\"http://x.test\";\"ver\")", veinticuatroHoras: false,
    });
    const campos = renglon.split(";");
    assert.equal(campos.length, 42);
    assert.equal(campos[39], " + PAGOS REPETIDOS");
    assert.equal(campos[40], ' =HIPERVINCULO("HTTP://X.TEST" "VER")');
  });

  it("r2-base-N15: área y cargo van sin acentos para el SITI; la Ñ se queda", () => {
    assert.equal(textoParaSiti("Dirección General"), "DIRECCION GENERAL");
    assert.equal(textoParaSiti("Director de Operación y Pingüino"), "DIRECTOR DE OPERACION Y PINGUINO");
    assert.equal(textoParaSiti("Compañía de Señales"), "COMPAÑIA DE SEÑALES");
  });

  it("r2-base-N19: el acta lleva la raya, las comillas y los puntos suspensivos de WinAnsi, no «?»", () => {
    assert.equal(winAnsi("PEÑA — PRESIDENTE"), "PEÑA \u0097 PRESIDENTE");
    assert.equal(winAnsi("– “a” ‘b’ … € •"), "\u0096 \u0093a\u0094 \u0091b\u0092 \u0085 \u0080 \u0095");
    assert.equal(winAnsi("中"), "?");
    assert.equal(winAnsi("\u0085"), "?", "un control C1 no se cuela como glifo de WinAnsi");
    const pdf = Buffer.from(pdfDeTexto([{ texto: "JOSE MARIA NUÑEZ PEÑA — PRESIDENTE TITULAR" }])).toString("latin1");
    assert.ok(pdf.includes("(JOSE MARIA NUÑEZ PEÑA \u0097 PRESIDENTE TITULAR) Tj"));
  });
});
