import { XMLParser, XMLValidator } from "fast-xml-parser";

import { leerCentavosEscritos } from "./centavos";
import { CONTROL, INVISIBLE, sinControles } from "./control";

export const PESO_MAXIMO_XML = 2_000_000;

export type CfdiLeido = {
  uuid: string;
  rfcEmisor: string;
  nombreEmisor: string;
  rfcReceptor: string;
  nombreReceptor: string;
  serie: string | null;
  folio: string | null;
  referencia: string;
  totalCentavos: number;
  emitidaEl: string;
  moneda: "MXN";
};

export type ResultadoCfdi = { ok: true; cfdi: CfdiLeido } | { ok: false; codigo: string };

/** Lee importes y partes del CFDI; no consulta ni afirma su vigencia ante el SAT. */
export function leerCfdi(bytes: Uint8Array): ResultadoCfdi {
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength < 100 || bytes.byteLength > PESO_MAXIMO_XML) {
    return { ok: false, codigo: "cfdi_invalido" };
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return { ok: false, codigo: "cfdi_codificacion" };
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) {
    return { ok: false, codigo: "cfdi_invalido" };
  }
  if (contenidoActivo(xml)) return { ok: false, codigo: "cfdi_contenido_no_permitido" };
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseAttributeValue: false,
      parseTagValue: false,
      // Apagado: encendido también expande las entidades de un DOCTYPE. Las referencias las decodifica `texto()`.
      processEntities: false,
      maxNestedTags: 40,
    });
    const raiz = registro(parser.parse(xml)?.Comprobante);
    if (!raiz || raiz["@_Version"] !== "4.0" || raiz["@_TipoDeComprobante"] !== "I" || raiz["@_Moneda"] !== "MXN") {
      return { ok: false, codigo: "cfdi_no_es_ingreso_mxn" };
    }
    const emisor = registro(raiz.Emisor);
    const receptor = registro(raiz.Receptor);
    const complemento = registro(raiz.Complemento);
    const timbre = registro(complemento?.TimbreFiscalDigital);
    const uuid = texto(timbre?.["@_UUID"], 36).toUpperCase();
    const rfcEmisor = texto(emisor?.["@_Rfc"], 13).toUpperCase();
    const rfcReceptor = texto(receptor?.["@_Rfc"], 13).toUpperCase();
    const nombreEmisor = texto(emisor?.["@_Nombre"], 254, { libre: true });
    const nombreReceptor = texto(receptor?.["@_Nombre"], 254, { libre: true });
    const fecha = texto(raiz["@_Fecha"], 35);
    const total = leerCentavosEscritos(texto(raiz["@_Total"], 40));
    const serie = textoOpcional(raiz["@_Serie"], 40);
    const folio = textoOpcional(raiz["@_Folio"], 40);
    // Lo que se guarda cabe en los CHECK de la base: el RFC receptor con su forma (`cliente_rfc`), la serie y el
    // folio sin caracteres invisibles (una referencia como «&#x9;» o «&#x200B;») y el total hasta 9e15 centavos.
    if (
      !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(uuid) ||
      !rfcEmisor || !/^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/.test(rfcReceptor) || !nombreEmisor || !nombreReceptor ||
      [serie, folio].some((valor) => valor !== null && INVISIBLE.test(valor)) ||
      total.tipo !== "centavos" || total.centavos <= 0 || total.centavos > 9_000_000_000_000_000 || !fechaCfdi(fecha)
    ) {
      return { ok: false, codigo: "cfdi_datos_incompletos" };
    }
    return {
      ok: true,
      cfdi: {
        uuid,
        rfcEmisor,
        nombreEmisor,
        rfcReceptor,
        nombreReceptor,
        serie,
        folio,
        referencia: [serie, folio].filter(Boolean).join("-") || `CFDI ${uuid.slice(0, 8)}`,
        totalCentavos: total.centavos,
        emitidaEl: fecha.slice(0, 10),
        moneda: "MXN",
      },
    };
  } catch {
    return { ok: false, codigo: "cfdi_invalido" };
  }
}

export function validarPdfPrivado(nombre: unknown, bytes: Uint8Array): { ok: true; nombre: string } | { ok: false } {
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength < 64 || bytes.byteLength > 8_000_000) return { ok: false };
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return { ok: false };
  const limpio = (typeof nombre === "string" ? nombre : "").replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  if (!limpio || limpio.length > 180 || CONTROL.test(limpio)) return { ok: false };
  return { ok: true, nombre: limpio };
}

/**
 * Un CFDI no trae marcado que un navegador ejecute. Se rechazan los espacios
 * de nombres de HTML, SVG, MathML, XLink, XSLT y XInclude (también escritos con
 * referencias de carácter), cualquier elemento script y la hoja de estilo XSL.
 */
const ESPACIOS_ACTIVOS = [
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1998/math/mathml",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/1999/xsl/transform",
  "http://www.w3.org/2001/xinclude",
];

function contenidoActivo(xml: string): boolean {
  if (/<\?\s*xml-stylesheet\b/i.test(xml)) return true;
  if (/<\s*(?:[A-Za-z_][\w.-]*:)?script(?=[\s/>])/i.test(xml)) return true;
  for (const declaracion of xml.matchAll(/\sxmlns(?::[^\s=]+)?\s*=\s*(["'])([\s\S]*?)\1/g)) {
    const valor = decodificarReferencias(declaracion[2] ?? "").trim().toLowerCase();
    if (ESPACIOS_ACTIVOS.some((espacio) => valor.includes(espacio))) return true;
  }
  return false;
}

function decodificarReferencias(valor: string): string {
  return valor.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_completa, ref: string) => {
    const nombre = ref.toLowerCase();
    if (nombre.startsWith("#")) {
      const punto = nombre.startsWith("#x") ? Number.parseInt(nombre.slice(2), 16) : Number.parseInt(nombre.slice(1), 10);
      return punto > 0 && punto <= 0x10ffff ? String.fromCodePoint(punto) : "�";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[nombre] ?? "";
  });
}

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

/**
 * El valor de un atributo como lo entrega un parser de XML 1.0. El tabulador y los saltos de línea literales valen
 * un espacio (§3.3.3); luego las referencias se decodifican en una sola pasada («&amp;amp;» queda «&amp;»). Un «&»
 * que no abre una de las cinco predefinidas ni una numérica (una entidad sin declarar) es un XML mal formado. Un
 * texto libre (`libre`, los nombres) quita además los controles que trae una referencia; en los demás atributos se
 * conservan para que su validación los rechace.
 */
function texto(valor: unknown, maximo: number, { libre = false } = {}): string {
  if (typeof valor !== "string") return "";
  const normalizado = valor.replace(/[\t\n\r]/g, " ");
  if (/&(?!(?:#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);)/.test(normalizado)) throw new Error("referencia_no_declarada");
  const decodificado = decodificarReferencias(normalizado);
  const limpio = (libre ? sinControles(decodificado).replace(/\s+/g, " ") : decodificado).trim();
  return limpio.length <= maximo ? limpio : "";
}

function textoOpcional(valor: unknown, maximo: number): string | null {
  const limpio = texto(valor, maximo);
  return limpio || null;
}

function fechaCfdi(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(valor)) return false;
  const fecha = new Date(`${valor.slice(0, 10)}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor.slice(0, 10);
}
