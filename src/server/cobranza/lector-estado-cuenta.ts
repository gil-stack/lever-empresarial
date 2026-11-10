import { Unzip, UnzipInflate } from "fflate";
import { XMLParser } from "fast-xml-parser";

/**
 * Lee el estado de cuenta que sube la empresa: CSV (lector propio, RFC 4180)
 * o XLSX (zip con fflate, XML con fast-xml-parser sin entidades ni DTD). Nunca
 * evalúa fórmulas: un XLSX con una celda de fórmula se rechaza y en un CSV todo
 * es texto. Devuelve la tabla cruda; qué columna es qué lo decide el empate.
 *
 * Topes: 2 MB de archivo, 5 000 renglones, 40 columnas y 25 MB inflados en
 * total (una zip bomb se corta al pasarlos, sin creerle al tamaño declarado).
 */

export type Celda = string | number | null;
export type Tabla = Celda[][];

export const TOPE_ARCHIVO = 2 * 1024 * 1024;
export const TOPE_RENGLONES = 5000;
export const TOPE_COLUMNAS = 40;
export const TOPE_INFLADO = 25 * 1024 * 1024;
const TOPE_CELDA = 500;
/** El zip entra en pedazos chicos: cada inflado queda acotado (DEFLATE no pasa de ~1 032:1). */
const PEDAZO = 4 * 1024;

/** Lo que vuelve al formulario como aviso del campo «archivo». */
export class ErrorDeLectura extends Error {
  constructor(readonly mensaje: string) {
    super("estado_de_cuenta_ilegible");
  }
}

export function leerEstadoDeCuenta(nombre: string, bytes: Uint8Array): Tabla {
  if (bytes.byteLength === 0) throw new ErrorDeLectura("El archivo está vacío.");
  if (bytes.byteLength > TOPE_ARCHIVO) throw new ErrorDeLectura("El archivo pesa más de 2 MB. Exporta un periodo más corto.");
  const extension = nombre.toLowerCase().split(".").pop() ?? "";
  const esZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (extension === "xlsx") {
    if (!esZip) throw new ErrorDeLectura("Este archivo dice ser .xlsx pero no es un libro de Excel válido. Exporta otra vez en Excel (.xlsx) o en CSV.");
    return leerXlsx(bytes);
  }
  if (extension === "csv" || extension === "txt") {
    if (esZip) throw new ErrorDeLectura("Este archivo dice ser .csv pero es un libro de Excel. Cámbiale la extensión a .xlsx o expórtalo en CSV.");
    return leerCsv(bytes);
  }
  throw new ErrorDeLectura("Sube el estado de cuenta en CSV o en Excel (.xlsx).");
}

// CSV ---------------------------------------------------------------------------------

export function leerCsv(bytes: Uint8Array): Tabla {
  const texto = decodificar(bytes);
  const separador = adivinarSeparador(texto);
  const tabla: Tabla = [];
  let renglon: Celda[] = [];
  let celda = "";
  let entreComillas = false;
  const cerrarCelda = () => {
    if (renglon.length >= TOPE_COLUMNAS) throw new ErrorDeLectura(`El archivo tiene más de ${TOPE_COLUMNAS} columnas.`);
    const limpia = celda.trim();
    renglon.push(limpia === "" ? null : limpia.slice(0, TOPE_CELDA));
    celda = "";
  };
  const cerrarRenglon = () => {
    cerrarCelda();
    if (renglon.some((c) => c !== null)) {
      if (tabla.length >= TOPE_RENGLONES) throw new ErrorDeLectura(`El archivo tiene más de ${TOPE_RENGLONES} renglones. Exporta un periodo más corto.`);
      tabla.push(renglon);
    }
    renglon = [];
  };
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]!;
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        celda += c;
      }
      if (celda.length > TOPE_CELDA * 4) throw new ErrorDeLectura("Una celda del archivo es demasiado larga.");
      continue;
    }
    if (c === '"' && celda.trim() === "") {
      entreComillas = true;
      celda = "";
    } else if (c === separador) {
      cerrarCelda();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i += 1;
      cerrarRenglon();
    } else {
      celda += c;
      if (celda.length > TOPE_CELDA * 4) throw new ErrorDeLectura("Una celda del archivo es demasiado larga.");
    }
  }
  if (entreComillas) throw new ErrorDeLectura("El archivo tiene unas comillas sin cerrar.");
  if (celda !== "" || renglon.length > 0) cerrarRenglon();
  if (tabla.length === 0) throw new ErrorDeLectura("El archivo no trae renglones.");
  return tabla;
}

/** UTF-8 (sin BOM) y, si no lo es, Windows-1252: así exportan varios bancos. */
function decodificar(bytes: Uint8Array): string {
  const sinBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(sinBom);
  } catch {
    texto = new TextDecoder("windows-1252").decode(sinBom);
  }
  if (texto.includes("\u0000")) throw new ErrorDeLectura("El archivo no es un CSV de texto.");
  return texto;
}

function adivinarSeparador(texto: string): string {
  const muestra = texto.split(/\r?\n/).slice(0, 20).join("\n").replace(/"[^"]*"/g, "");
  const cuenta = (s: string) => muestra.split(s).length - 1;
  const opciones: [string, number][] = [[",", cuenta(",")], [";", cuenta(";")], ["\t", cuenta("\t")], ["|", cuenta("|")]];
  opciones.sort((a, b) => b[1] - a[1]);
  return opciones[0]![1] > 0 ? opciones[0]![0] : ",";
}

// XLSX --------------------------------------------------------------------------------

const PARTES = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[A-Za-z0-9_]+\.xml)$/;

/**
 * Infla solo las partes que hacen falta, en pedazos, contando lo inflado. Al
 * pasar el tope se detiene todo: el tamaño que declara el zip no se usa.
 */
export function abrirZip(bytes: Uint8Array, tope = TOPE_INFLADO): Map<string, Uint8Array> {
  const partes = new Map<string, Uint8Array[]>();
  let inflado = 0;
  let excedido = false;
  let error: unknown = null;
  const unzip = new Unzip((archivo) => {
    if (!PARTES.test(archivo.name) || excedido) return;
    const pedazos: Uint8Array[] = [];
    partes.set(archivo.name, pedazos);
    archivo.ondata = (err, datos) => {
      if (err) {
        error = err;
        return;
      }
      inflado += datos.byteLength;
      if (inflado > tope) {
        excedido = true;
        archivo.terminate();
        return;
      }
      pedazos.push(datos);
    };
    archivo.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let i = 0; i < bytes.byteLength && !excedido; i += PEDAZO) {
      unzip.push(bytes.subarray(i, i + PEDAZO), i + PEDAZO >= bytes.byteLength);
    }
  } catch {
    throw new ErrorDeLectura("El libro de Excel está dañado. Exporta otra vez el estado de cuenta.");
  }
  if (excedido) throw new ErrorDeLectura("El libro de Excel se infla a más de 25 MB. Exporta un periodo más corto o en CSV.");
  if (error) throw new ErrorDeLectura("El libro de Excel está dañado. Exporta otra vez el estado de cuenta.");
  const unidas = new Map<string, Uint8Array>();
  for (const [nombre, pedazos] of partes) {
    const total = pedazos.reduce((s, p) => s + p.byteLength, 0);
    const junto = new Uint8Array(total);
    let i = 0;
    for (const p of pedazos) {
      junto.set(p, i);
      i += p.byteLength;
    }
    unidas.set(nombre, junto);
  }
  return unidas;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  // Ni entidades ni DTD: además, una parte con <!DOCTYPE o <!ENTITY se rechaza antes de llegar aquí.
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: 20,
  isArray: (nombre) => ["si", "r", "row", "c", "sheet", "Relationship"].includes(nombre),
});

export function xmlSeguro(bytes: Uint8Array): Record<string, unknown> {
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ErrorDeLectura("El libro de Excel trae texto que no es UTF-8.");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) throw new ErrorDeLectura("El libro de Excel trae declaraciones que no se aceptan (DTD o entidades).");
  try {
    const leido = parser.parse(texto) as unknown;
    return leido && typeof leido === "object" ? (leido as Record<string, unknown>) : {};
  } catch {
    throw new ErrorDeLectura("El libro de Excel está dañado. Exporta otra vez el estado de cuenta.");
  }
}

/** Las cinco entidades de XML y las referencias numéricas; nada más (sin DTD no hay otras). */
export function decodificarXml(texto: string): string {
  return texto.replace(/&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/g, (_m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const punto = e.startsWith("#x") ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return punto > 0 && punto <= 0x10ffff ? String.fromCodePoint(punto) : "";
  });
}

function lista(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object") : [];
}

function textoDe(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return textoDe((v as Record<string, unknown>)["#text"]);
  return "";
}

/** Texto de un <si> o <is>: <t> directo o la suma de sus <r><t>. */
function textoRico(nodo: Record<string, unknown> | undefined): string {
  if (!nodo) return "";
  if (nodo.t !== undefined) return decodificarXml(textoDe(nodo.t));
  return lista(nodo.r).map((r) => decodificarXml(textoDe(r.t))).join("");
}

export function leerXlsx(bytes: Uint8Array): Tabla {
  const partes = abrirZip(bytes);
  const hoja = rutaPrimeraHoja(partes);
  const datos = hoja ? partes.get(hoja) : undefined;
  if (!datos) throw new ErrorDeLectura("Este archivo no es un libro de Excel válido. Exporta otra vez en Excel (.xlsx) o en CSV.");
  const compartidas = partes.has("xl/sharedStrings.xml")
    ? lista(registro(xmlSeguro(partes.get("xl/sharedStrings.xml")!).sst)?.si).map(textoRico)
    : [];
  const hojaXml = registro(xmlSeguro(datos).worksheet);
  const filas = lista(registro(hojaXml?.sheetData)?.row);
  if (filas.length > TOPE_RENGLONES) throw new ErrorDeLectura(`El archivo tiene más de ${TOPE_RENGLONES} renglones. Exporta un periodo más corto.`);
  const tabla: Tabla = [];
  for (const fila of filas) {
    const renglon: Celda[] = [];
    let siguiente = 0;
    for (const celda of lista(fila.c)) {
      if (celda.f !== undefined) throw new ErrorDeLectura("El libro trae fórmulas. Exporta el estado de cuenta tal cual sale del banco, sin fórmulas, o en CSV.");
      const ref = typeof celda["@_r"] === "string" ? celda["@_r"] : "";
      const columna = ref ? columnaDe(ref) : siguiente;
      if (columna < 0 || columna >= TOPE_COLUMNAS) throw new ErrorDeLectura(`El archivo tiene más de ${TOPE_COLUMNAS} columnas.`);
      while (renglon.length < columna) renglon.push(null);
      renglon[columna] = valorDe(celda, compartidas);
      siguiente = columna + 1;
    }
    if (renglon.some((c) => c !== null)) tabla.push(renglon);
  }
  if (tabla.length === 0) throw new ErrorDeLectura("La primera hoja del libro está vacía.");
  return tabla;
}

function valorDe(celda: Record<string, unknown>, compartidas: readonly string[]): Celda {
  const tipo = celda["@_t"];
  if (tipo === "inlineStr") return recorte(textoRico(registro(celda.is)));
  const v = textoDe(celda.v);
  if (v === "") return null;
  if (tipo === "s") {
    const i = Number(v);
    return Number.isInteger(i) && i >= 0 && i < compartidas.length ? recorte(compartidas[i]!) : null;
  }
  if (tipo === "str" || tipo === "e") return recorte(decodificarXml(v));
  if (tipo === "b") return v === "1" ? "VERDADERO" : "FALSO";
  const n = Number(v);
  return Number.isFinite(n) ? n : recorte(decodificarXml(v));
}

function recorte(s: string): Celda {
  const limpio = s.trim().slice(0, TOPE_CELDA);
  return limpio === "" ? null : limpio;
}

/** «AB12» → 27 (desde 0). */
function columnaDe(ref: string): number {
  const letras = /^([A-Z]{1,3})[0-9]+$/.exec(ref)?.[1];
  if (!letras) return -1;
  let n = 0;
  for (const l of letras) n = n * 26 + (l.charCodeAt(0) - 64);
  return n - 1;
}

/** La primera hoja del libro según workbook.xml y sus relaciones; si faltan, sheet1.xml. */
function rutaPrimeraHoja(partes: Map<string, Uint8Array>): string | null {
  const libro = partes.get("xl/workbook.xml");
  const rels = partes.get("xl/_rels/workbook.xml.rels");
  if (libro && rels) {
    const primera = lista(registro(registro(xmlSeguro(libro).workbook)?.sheets)?.sheet)[0];
    const rid = primera?.["@_id"];
    const rel = lista(registro(xmlSeguro(rels).Relationships)?.Relationship).find((r) => r["@_Id"] === rid);
    const destino = typeof rel?.["@_Target"] === "string" ? rel["@_Target"].replace(/^\/?xl\//, "") : null;
    if (destino && /^worksheets\/[A-Za-z0-9_]+\.xml$/.test(destino)) return `xl/${destino}`;
  }
  return partes.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : null;
}

function registro(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
