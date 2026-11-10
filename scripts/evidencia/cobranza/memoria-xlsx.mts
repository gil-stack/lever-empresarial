// H6 del revisor (revision-63-scripts/h6-parser.ts) ampliado: costo del lector de XLSX por caso, en un proceso propio.
// Uso, desde la raíz: tsx --expose-gc scripts/evidencia/cobranza/memoria-xlsx.mts "$PWD/src/server/cobranza/lector-estado-cuenta.ts" <caso>
import { zipSync, strToU8 } from "fflate";
const { leerEstadoDeCuenta } = await import(process.argv[2]!);
const caso = process.argv[3]!;
function libro(hoja: string, sst?: string): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="r"><sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(hoja),
    ...(sst ? { "xl/sharedStrings.xml": strToU8(sst) } : {}),
  }, { level: 9 });
}
const col = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : "") + String.fromCharCode(65 + (i % 26));
const legitimo = () => {
  let s = "<worksheet><sheetData>";
  for (let r = 1; r <= 5000; r++) { s += `<row r="${r}">`; for (let c = 0; c < 40; c++) s += c % 2 ? `<c r="${col(c)}${r}" s="3"><v>${r * 40 + c}.5</v></c>` : `<c r="${col(c)}${r}" s="3" t="s"><v>${(r * 40 + c) % 9000}</v></c>`; s += "</row>"; }
  return s + "</sheetData></worksheet>";
};
const sst = `<sst>${Array.from({ length: 9000 }, (_, i) => `<si><t>Concepto SPEI ${i} RECIBIDO</t></si>`).join("")}</sst>`;
const casos: Record<string, () => [string, string?]> = {
  // Los dos del revisor: 24 MB inflados.
  celdas: () => [`<worksheet><sheetData><row r="1">${'<c t="inlineStr"><is><t>x</t></is></c>'.repeat(24 * 1024 * 1024 / 38)}</row></sheetData></worksheet>`],
  filas: () => [`<worksheet><sheetData>${'<row r="1"/>'.repeat(24 * 1024 * 1024 / 12)}</sheetData></worksheet>`],
  // Bajo los 10 MB por parte pero con más nodos que el tope: caen por conteo antes del parser.
  celdasBajoTope: () => [`<worksheet><sheetData><row r="1">${'<c t="inlineStr"><is><t>x</t></is></c>'.repeat(9.5 * 1024 * 1024 / 38)}</row></sheetData></worksheet>`],
  filasBajoTope: () => [`<worksheet><sheetData>${'<row r="1"/>'.repeat(9.5 * 1024 * 1024 / 12)}</sheetData></worksheet>`],
  cadenasBajoTope: () => ['<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>', `<sst>${"<si><t>x</t></si>".repeat(9.5 * 1024 * 1024 / 17)}</sst>`],
  // Un libro legítimo en el tope: 5 000 renglones × 40 columnas con estilo y 9 000 textos compartidos.
  legitimo5000x40: () => [legitimo(), sst],
};
const [hoja, compartidas] = casos[caso]!();
const bytes = libro(hoja, compartidas);
global.gc?.();
const antes = process.memoryUsage();
let pico = 0;
const t = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 2);
const t0 = performance.now();
let resultado = "";
try { const tabla = leerEstadoDeCuenta("x.xlsx", bytes); resultado = `leído ${tabla.length} renglones`; } catch (e) { resultado = (e as { mensaje?: string }).mensaje ?? String(e); }
const ms = Math.round(performance.now() - t0);
clearInterval(t);
const despues = process.memoryUsage();
pico = Math.max(pico, despues.rss);
console.log(JSON.stringify({ caso, zipKB: Math.round(bytes.byteLength / 1024), infladoMB: Math.round((hoja.length + (compartidas?.length ?? 0)) / 1048576 * 10) / 10, ms, rssMB: Math.round(despues.rss / 1048576), picoRssMB: Math.round(pico / 1048576), heapDeltaMB: Math.round((despues.heapUsed - antes.heapUsed) / 1048576), resultado }));
