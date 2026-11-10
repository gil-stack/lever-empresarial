import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

import { aplicarEmpate, leerFecha, leerMonto, referenciaEnTexto, sugerirEmpate, validarEmpate } from "../../dominio/cobranza/estado-cuenta";
import { abrirZip, decodificarXml, ErrorDeLectura, leerCsv, leerEstadoDeCuenta, TOPE_RENGLONES, xmlSeguro } from "./lector-estado-cuenta";

const HOY = "2026-11-10";

/** Un .xlsx mínimo hecho aquí: libro, relación, hoja y (opcional) textos compartidos. */
function xlsx(hoja: string, compartidas?: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Movimientos" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${hoja}</sheetData></worksheet>`),
  };
  if (compartidas !== undefined) {
    archivos["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${compartidas}</sst>`);
  }
  return zipSync({ ...archivos, ...extra }, { level: 9 });
}

const ilegible = (fragmento: RegExp) => (e: unknown) => e instanceof ErrorDeLectura && fragmento.test(e.mensaje);

describe("estado de cuenta: XLSX", () => {
  it("lee textos compartidos (sharedStrings) y texto en línea (inlineStr)", () => {
    const hoja = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>15/11/2026</t></is></c><c r="B2"><v>1500.5</v></c><c r="D2" t="inlineStr"><is><r><t>Pago </t></r><r><t>&amp; más</t></r></is></c></row>';
    const tabla = leerEstadoDeCuenta("banco.xlsx", xlsx(hoja, "<si><t>Fecha</t></si><si><r><t>Abo</t></r><r><t>no</t></r></si>"));
    assert.deepEqual(tabla, [["Fecha", "Abono"], ["15/11/2026", 1500.5, null, "Pago & más"]]);
  });

  it("interpreta una fecha guardada como número de serie de Excel", () => {
    const hoja = '<row r="1"><c r="A1" t="inlineStr"><is><t>Fecha</t></is></c><c r="B1" t="inlineStr"><is><t>Depósito</t></is></c></row>'
      + '<row r="2"><c r="A2" s="1"><v>46341</v></c><c r="B2"><v>2500</v></c></row>';
    const tabla = leerEstadoDeCuenta("banco.xlsx", xlsx(hoja));
    const empate = sugerirEmpate(tabla);
    assert.ok(empate);
    const lectura = aplicarEmpate(tabla, empate, "bbva", "2026-12-31");
    assert.equal(lectura.abonos[0]?.fecha, "2026-11-15");
    assert.equal(lectura.abonos[0]?.montoCentavos, 250_000);
  });

  it("rechaza una celda con fórmula", () => {
    const hoja = '<row r="1"><c r="A1"><f>SUM(B1:B2)</f><v>3</v></c></row>';
    assert.throws(() => leerEstadoDeCuenta("banco.xlsx", xlsx(hoja)), ilegible(/fórmulas/));
  });

  it("rechaza una hoja con más renglones que el tope", () => {
    const filas = Array.from({ length: TOPE_RENGLONES + 1 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join("");
    assert.throws(() => leerEstadoDeCuenta("banco.xlsx", xlsx(filas)), ilegible(/más de 5000 renglones/));
  });

  it("corta una zip bomb sin creerle al tamaño declarado y sin agotar la memoria", () => {
    // 60 MB de ceros comprimen a unos 60 KB: el archivo pasa el tope de 2 MB, el inflado no.
    const ceros = new Uint8Array(60 * 1024 * 1024);
    const bomba = zipSync({ "xl/worksheets/sheet1.xml": ceros }, { level: 9 });
    assert.ok(bomba.byteLength < 2 * 1024 * 1024);
    const antes = process.memoryUsage().arrayBuffers;
    assert.throws(() => leerEstadoDeCuenta("bomba.xlsx", bomba), ilegible(/se infla a más de 25 MB/));
    // Lo retenido no pasa de lo inflado hasta el tope más un pedazo.
    assert.ok(process.memoryUsage().arrayBuffers - antes < 40 * 1024 * 1024);
    // Y con un tope chico se corta igual.
    assert.throws(() => abrirZip(bomba, 1024 * 1024), ilegible(/se infla/));
  });

  it("un archivo que no es XLSX con extensión .xlsx da su aviso en el campo, nunca un error de base", () => {
    assert.throws(() => leerEstadoDeCuenta("estado.xlsx", new TextEncoder().encode("Fecha,Abono\n15/11/2026,100\n")), ilegible(/no es un libro de Excel/));
    assert.throws(() => leerEstadoDeCuenta("estado.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6])), ilegible(/no es un libro de Excel/));
    assert.throws(() => leerEstadoDeCuenta("estado.pdf", new Uint8Array([1, 2, 3])), ilegible(/CSV o en Excel/));
  });

  it("resiste XXE y expansión de entidades: con DTD se rechaza y sin DTD nada se expande", () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><sst><si><t>&xxe;</t></si></sst>';
    assert.throws(() => xmlSeguro(strToU8(xxe)), ilegible(/DTD o entidades/));
    const risa = `<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY a "aaaaaaaaaa">${Array.from({ length: 9 }, (_, i) => `<!ENTITY ${String.fromCharCode(98 + i)} "${`&${String.fromCharCode(97 + i)};`.repeat(10)}">`).join("")}]><sst><si><t>&j;</t></si></sst>`;
    assert.throws(() => xmlSeguro(strToU8(risa)), ilegible(/DTD o entidades/));
    const hoja = '<row r="1"><c r="A1" t="s"><v>0</v></c></row>';
    assert.throws(() => leerEstadoDeCuenta("banco.xlsx", xlsx(hoja, undefined, { "xl/sharedStrings.xml": strToU8(xxe) })), ilegible(/DTD o entidades/));
    // El parser de la configuración (processEntities: false) no expande una entidad aunque le llegue un DTD.
    const crudo = new XMLParser({ processEntities: false }).parse('<!DOCTYPE a [<!ENTITY x "EXPANDIDA">]><a>&x;</a>') as { a: unknown };
    assert.equal(crudo.a, "&x;");
    // El decodificador propio solo conoce las cinco de XML y las numéricas.
    assert.equal(decodificarXml("&amp;&lt;&gt;&quot;&apos;&#233;&#xE9;&xxe;"), "&<>\"'éé&xxe;");
  });
});

describe("estado de cuenta: CSV", () => {
  it("lee comillas, comillas dobles, punto y coma, CRLF, BOM y Windows-1252", () => {
    const utf8 = new TextEncoder().encode('﻿Fecha;Concepto;Abono\r\n15/11/2026;"Pago ""uno""; con punto y coma";"1,234.50"\r\n');
    assert.deepEqual(leerCsv(utf8), [["Fecha", "Concepto", "Abono"], ["15/11/2026", 'Pago "uno"; con punto y coma', "1,234.50"]]);
    const latin = new Uint8Array([...new TextEncoder().encode("Fecha,Dep"), 0xf3, ...new TextEncoder().encode("sito\n15/11/2026,10\n")]);
    assert.equal(leerCsv(latin)[0]?.[1], "Depósito");
  });

  it("nunca evalúa fórmulas: el texto queda neutralizado", () => {
    const tabla = leerCsv(new TextEncoder().encode("Fecha,Concepto,Abono\n15/11/2026,=HYPERLINK(\"http://x\"),100\n16/11/2026,@SUM(1),200\n"));
    const empate = sugerirEmpate(tabla)!;
    const lectura = aplicarEmpate(tabla, empate, "banorte", HOY > "2026-11-16" ? HOY : "2026-11-30");
    assert.deepEqual(lectura.abonos.map((a) => a.concepto), ["'=HYPERLINK(\"http://x\")", "'@SUM(1)"]);
  });

  it("topa renglones y columnas", () => {
    const muchas = "a,".repeat(41) + "\n";
    assert.throws(() => leerCsv(new TextEncoder().encode(muchas)), ilegible(/más de 40 columnas/));
    const renglones = Array.from({ length: TOPE_RENGLONES + 1 }, (_, i) => `15/11/2026,${i + 1}`).join("\n");
    assert.throws(() => leerCsv(new TextEncoder().encode(renglones)), ilegible(/más de 5000 renglones/));
    assert.throws(() => leerCsv(new TextEncoder().encode('Fecha,"sin cerrar\n')), ilegible(/comillas sin cerrar/));
  });
});

describe("estado de cuenta: montos, fechas, empate y huella", () => {
  it("montos en formato mexicano", () => {
    const casos: [string | number, number | null][] = [
      ["$1,234.56", 123_456], ["1234.56", 123_456], ["1,234", 123_400], ["1.234,56", 123_456], ["1234,5", 123_450],
      ["(1,000.00)", -100_000], ["-500", -50_000], ["2,500.00 MXN", 250_000], [1500.5, 150_050], ["abc", null], ["", null], ["1.2.3", null],
    ];
    for (const [entrada, esperado] of casos) assert.equal(leerMonto(entrada), esperado, String(entrada));
  });

  it("fechas como las exportan los bancos", () => {
    const casos: [string | number, string | null][] = [
      ["15/11/2026", "2026-11-15"], ["15-11-26", "2026-11-15"], ["2026-11-15", "2026-11-15"], ["15/NOV/2026", "2026-11-15"],
      ["15 nov 2026", "2026-11-15"], ["01-dic-2026", "2026-12-01"], [46341, "2026-11-15"], ["31/02/2026", null], ["hoy", null], [12, null],
    ];
    for (const [entrada, esperado] of casos) assert.equal(leerFecha(entrada), esperado, String(entrada));
  });

  it("encuentra la referencia de Lever en el concepto solo si es una y válida", () => {
    assert.equal(referenciaEnTexto("SPEI RECIBIDO REF 0000018 COLEGIO"), "0000018");
    assert.equal(referenciaEnTexto("REF 0000019"), null);
    assert.equal(referenciaEnTexto("0000018 y 0000026"), null);
  });

  it("la misma tabla da las mismas claves; dos depósitos idénticos son dos renglones", () => {
    const tabla = [["Fecha", "Concepto", "Abono", "Cargo"], ["15/11/2026", "SPEI", "100.00", ""], ["15/11/2026", "SPEI", "100.00", ""], ["15/11/2026", "Comisión", "", "10.00"], ["Saldo final", "", "", ""]];
    const empate = validarEmpate({ filaEncabezado: "0", columnaFecha: "0", columnaAbono: "2", columnaConcepto: "1" }, 4, tabla.length);
    assert.ok(!("error" in empate));
    const una = aplicarEmpate(tabla, empate, "santander", HOY > "2026-11-15" ? HOY : "2026-11-30");
    const otra = aplicarEmpate(tabla, empate, "santander", "2026-11-30");
    assert.equal(una.abonos.length, 2);
    assert.notEqual(una.abonos[0]?.clave, una.abonos[1]?.clave);
    assert.deepEqual(una.abonos.map((a) => a.clave), otra.abonos.map((a) => a.clave));
    assert.equal(una.renglones, 4);
  });

  it("el empate valida columnas y renglón de títulos", () => {
    assert.deepEqual(validarEmpate({ filaEncabezado: "0", columnaFecha: "0", columnaAbono: "0" }, 3, 5), { campo: "columnaAbono", error: "La fecha y el abono no pueden ser la misma columna." });
    assert.equal((validarEmpate({ filaEncabezado: "9", columnaFecha: "0", columnaAbono: "1" }, 3, 5) as { campo: string }).campo, "filaEncabezado");
    assert.equal((validarEmpate({ filaEncabezado: "0", columnaFecha: "0", columnaAbono: "7" }, 3, 5) as { campo: string }).campo, "columnaAbono");
  });

  it("los abonos de fecha futura o sin fecha no entran", () => {
    const tabla = [["Fecha", "Abono"], ["15/12/2026", "100"], ["sin fecha", "100"], ["15/11/2026", "100"]];
    const lectura = aplicarEmpate(tabla, sugerirEmpate(tabla)!, "otro", "2026-11-20");
    assert.deepEqual([lectura.abonos.length, lectura.futuros, lectura.sinFecha], [1, 1, 1]);
  });
});
