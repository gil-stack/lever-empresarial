import { XMLParser, XMLValidator } from "fast-xml-parser";

import { leerCentavosEscritos } from "./centavos";

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
    const nombreEmisor = texto(emisor?.["@_Nombre"], 254);
    const nombreReceptor = texto(receptor?.["@_Nombre"], 254);
    const fecha = texto(raiz["@_Fecha"], 35);
    const total = leerCentavosEscritos(texto(raiz["@_Total"], 40));
    if (
      !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(uuid) ||
      !rfcEmisor || !rfcReceptor || !nombreEmisor || !nombreReceptor ||
      total.tipo !== "centavos" || total.centavos <= 0 || !fechaCfdi(fecha)
    ) {
      return { ok: false, codigo: "cfdi_datos_incompletos" };
    }
    const serie = textoOpcional(raiz["@_Serie"], 40);
    const folio = textoOpcional(raiz["@_Folio"], 40);
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
  if (!limpio || limpio.length > 180 || /[\u0000-\u001f\u007f]/.test(limpio)) return { ok: false };
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

function texto(valor: unknown, maximo: number): string {
  return typeof valor === "string" && valor.trim().length <= maximo ? valor.trim() : "";
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
