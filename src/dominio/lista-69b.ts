import { normalizarRfcDeAlta, validarRfc as validarRfcSat } from "../domain/rfc";
import { normalizarRfc } from "./rfc";

/**
 * Página que el plan cita para el listado del artículo 69-B.
 * El enlace del archivo se lee de esa página cuando el servidor la descarga.
 * No hay otra dirección del SAT escrita en el producto.
 */
export const PAGINA_LISTADO_69B =
  "https://www.sat.gob.mx/minisitio/DatosAbiertos/contribuyentes_publicados.html";

/** Esta pantalla no envía dinero, aunque el RFC no esté en el archivo. */
export const ESTA_PANTALLA_ENVIA_DINERO = false;

export const TOPE_FILAS_69B = 200_000;
export const TOPE_SITUACION = 120;

const TITULO_69B = "Artículo 69-B del Código Fiscal de la Federación";
const TITULO_69B_BIS = "Artículo 69-B Bis";
const TEXTO_LISTADO = "Listado completo";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const MES: Readonly<Record<string, number>> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const FRASE_FECHA =
  /Información actualizada al\s+(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚÜáéíóúüñÑ]+)\s+de\s+(\d{4})/u;

export type Fila69b = {
  rfc: string;
  situacion: string;
};

export type CodigoListado =
  | "pagina_irreconocible"
  | "url_no_publica"
  | "sin_fecha"
  | "sin_encabezado"
  | "fila_incompleta"
  | "rfc_ajeno"
  | "listado_vacio"
  | "listado_demasiado_grande";

export type Pagina69b =
  | { ok: true; fechaArchivo: string; urlListado: string }
  | { ok: false; codigo: CodigoListado };

export type Archivo69b =
  | { ok: true; fechaArchivo: string; filas: Fila69b[] }
  | { ok: false; codigo: CodigoListado };

export type MotivoPago69b = "sin_archivo" | "en_el_listado" | "fuera_del_listado";

export type DecisionPago69b = {
  /**
   * La regla del archivo. Verdadero solo si hay copia y el RFC no aparece.
   * No es una orden de enviar dinero.
   */
  listaPermitePago: boolean;
  motivo: MotivoPago69b;
  situaciones: string[];
};

/** El alta del proveedor no se impide por estar en el listado. El pago sí. */
export function elProveedorPuedeExistir(): true {
  return true;
}

export function puedeVerLista69b(rol: string | null | undefined): boolean {
  return rol === "administrador" || rol === "solicitante" || rol === "liberador" || rol === "contador";
}

export function puedeGuardarLista69b(rol: string | null | undefined, esOperador: boolean): boolean {
  return esOperador || rol === "administrador";
}

export function decidirPago69b(entrada: {
  hayArchivo: boolean;
  situaciones: readonly string[];
}): DecisionPago69b {
  if (!entrada.hayArchivo) {
    return { listaPermitePago: false, motivo: "sin_archivo", situaciones: [] };
  }
  const situaciones = [...entrada.situaciones];
  if (situaciones.length > 0) {
    return { listaPermitePago: false, motivo: "en_el_listado", situaciones };
  }
  return { listaPermitePago: true, motivo: "fuera_del_listado", situaciones: [] };
}

/** La misma frase en la ficha y en la lista cuando el archivo no deja pagar. */
export const FRASE_SIN_PAGO = "El proveedor puede existir. El pago no.";

/** Esta pantalla no manda el pago, aunque el archivo no lo impida. */
export const FRASE_ESTA_PANTALLA = "Esta pantalla no envía dinero.";

export function fraseDePago69b(decision: DecisionPago69b): string {
  if (decision.motivo === "fuera_del_listado") return FRASE_ESTA_PANTALLA;
  return FRASE_SIN_PAGO;
}

export function fraseFechaArchivo(iso: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (!partes) return iso;
  const mes = MESES[Number(partes[2]) - 1];
  if (!mes) return iso;
  return `${Number(partes[3])} de ${mes} de ${partes[1]}`;
}

export { horaEnMexico } from "./reloj";

export function fraseConteo(cantidad: number): string {
  return new Intl.NumberFormat("es-MX").format(cantidad);
}

export function decodificarListado(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** La sección del 69-B, sin el 69-B Bis, y el enlace «Listado completo» que esa sección publica. */
export function leerPagina69b(html: string, base = PAGINA_LISTADO_69B): Pagina69b {
  const desde = html.indexOf(TITULO_69B);
  if (desde < 0) return { ok: false, codigo: "pagina_irreconocible" };
  const hasta = html.indexOf(TITULO_69B_BIS, desde + TITULO_69B.length);
  const seccion = hasta < 0 ? html.slice(desde) : html.slice(desde, hasta);
  const fechaArchivo = fechaEn(seccion);
  if (!fechaArchivo) return { ok: false, codigo: "sin_fecha" };
  const href = hrefDelListadoCompleto(seccion);
  if (!href) return { ok: false, codigo: "pagina_irreconocible" };
  const urlListado = urlPublica(href, base);
  if (!urlListado) return { ok: false, codigo: "url_no_publica" };
  return { ok: true, fechaArchivo, urlListado };
}

export function leerArchivo69b(texto: string): Archivo69b {
  const registros = registrosCsv(texto);
  const encabezado = registros.findIndex((fila) => esEncabezado(fila));
  if (encabezado < 0) return { ok: false, codigo: "sin_encabezado" };
  const fechaArchivo = fechaEn(registros.slice(0, encabezado).flat().join(" "));
  if (!fechaArchivo) return { ok: false, codigo: "sin_fecha" };

  const columnas = registros[encabezado] ?? [];
  const rfcEn = columnas.findIndex((celda) => celda.trim() === "RFC");
  const situacionEn = columnas.findIndex((celda) => celda.trim() === "Situación del contribuyente");
  if (rfcEn < 0 || situacionEn < 0) return { ok: false, codigo: "sin_encabezado" };

  const vistos = new Set<string>();
  const filas: Fila69b[] = [];
  let datos = 0;
  for (const registro of registros.slice(encabezado + 1)) {
    if (registro.every((celda) => celda.trim() === "")) continue;
    datos += 1;
    if (datos > TOPE_FILAS_69B) return { ok: false, codigo: "listado_demasiado_grande" };
    if (registro.length <= Math.max(rfcEn, situacionEn)) return { ok: false, codigo: "fila_incompleta" };
    const rfc = normalizarRfc(registro[rfcEn] ?? "");
    const situacion = (registro[situacionEn] ?? "").trim();
    if (rfc.length === 0 || situacion.length === 0) return { ok: false, codigo: "fila_incompleta" };
    if (rfc.length < 12 || rfc.length > 13) return { ok: false, codigo: "rfc_ajeno" };
    if (situacion.length > TOPE_SITUACION) return { ok: false, codigo: "fila_incompleta" };
    const clave = `${rfc}\u0000${situacion}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    filas.push({ rfc, situacion });
  }
  if (filas.length === 0) return { ok: false, codigo: "listado_vacio" };
  return { ok: true, fechaArchivo, filas };
}

function esEncabezado(fila: readonly string[]): boolean {
  const celdas = fila.map((celda) => celda.trim());
  return celdas.includes("RFC") && celdas.includes("Situación del contribuyente");
}

function fechaEn(texto: string): string | null {
  const hallada = FRASE_FECHA.exec(texto);
  if (!hallada) return null;
  const dia = Number(hallada[1]);
  const mes = MES[hallada[2]?.toLocaleLowerCase("es-MX") ?? ""];
  const anio = Number(hallada[3]);
  if (!mes || !Number.isInteger(dia) || !Number.isInteger(anio)) return null;
  return fechaIso(anio, mes, dia);
}

function fechaIso(anio: number, mes: number, dia: number): string | null {
  if (anio < 2000 || anio > 2100) return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    return null;
  }
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function hrefDelListadoCompleto(seccion: string): string | null {
  const anclas = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  for (const ancla of seccion.matchAll(anclas)) {
    if (textoPlano(ancla[2] ?? "") !== TEXTO_LISTADO) continue;
    const href = hrefDe(ancla[1] ?? "");
    if (href) return href;
  }
  return null;
}

function hrefDe(atributos: string): string | null {
  const hallado = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(atributos);
  const href = hallado?.[1] ?? hallado?.[2] ?? hallado?.[3] ?? "";
  return href.length > 0 ? href : null;
}

function textoPlano(html: string): string {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/gu, " ")
    .trim();
}

/** https público. Rechaza loopback, IP literales y nombres de una sola etiqueta. */
export function urlPublica(href: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (host.length === 0 || !host.includes(".")) return null;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return null;
  }
  if (host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return null;
  return url.toString();
}

function registrosCsv(texto: string): string[][] {
  const fuente = texto.replace(/^\uFEFF/u, "");
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < fuente.length; i += 1) {
    const caracter = fuente[i];
    if (caracter === "\r") continue;
    if (entreComillas) {
      if (caracter === '"') {
        if (fuente[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        campo += caracter;
      }
      continue;
    }
    if (caracter === '"') {
      entreComillas = true;
      continue;
    }
    if (caracter === ",") {
      fila.push(campo);
      campo = "";
      continue;
    }
    if (caracter === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
      continue;
    }
    campo += caracter;
  }
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/**
 * Lectura del CSV que usa el alta cuando el servidor ya tiene el texto.
 * Una fila ilegible se salta. Un archivo sin fecha o sin filas no se guarda:
 * guardarlo abriría el pago.
 */
const CONTROL_LISTADO = /[\u0000-\u001F\u007F]/;
const MES_LISTADO: Readonly<Record<string, string>> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

export type Listado69b =
  | { ok: true; fechaArchivo: string; filas: Fila69b[] }
  | { ok: false; codigo: "listado_ilegible" | "listado_sin_fecha" };

export function leerListado69b(texto: string): Listado69b {
  const filas = filasCsv(texto);
  const encabezado = filas.findIndex((fila) => {
    const planas = fila.map(planaListado);
    return planas.includes("rfc") && planas.some((celda) => celda.includes("situacion"));
  });
  if (encabezado < 0) return { ok: false, codigo: "listado_ilegible" };

  const fechaArchivo = fechaEnPreambulo(filas.slice(0, encabezado));
  if (!fechaArchivo) return { ok: false, codigo: "listado_sin_fecha" };

  const columnas = filas[encabezado]?.map(planaListado) ?? [];
  const columnaRfc = columnas.indexOf("rfc");
  const columnaSituacion = columnas.findIndex((celda) => celda.includes("situacion"));
  if (columnaRfc < 0 || columnaSituacion < 0) return { ok: false, codigo: "listado_ilegible" };

  const vistas = new Map<string, Fila69b>();
  for (const fila of filas.slice(encabezado + 1)) {
    const leida = leerFilaListado(fila, columnaRfc, columnaSituacion);
    if (!leida) continue;
    vistas.set(`${leida.rfc}\n${leida.situacion}`, leida);
  }
  if (vistas.size === 0) return { ok: false, codigo: "listado_ilegible" };

  return { ok: true, fechaArchivo, filas: [...vistas.values()] };
}

function leerFilaListado(fila: string[], columnaRfc: number, columnaSituacion: number): Fila69b | null {
  const crudo = fila[columnaRfc] ?? "";
  const validado = validarRfcSat(normalizarRfcDeAlta(crudo));
  if (!validado.ok) return null;
  const situacion = (fila[columnaSituacion] ?? "").trim();
  if (situacion.length === 0 || situacion.length > TOPE_SITUACION || CONTROL_LISTADO.test(situacion)) return null;
  return { rfc: validado.rfc, situacion };
}

function fechaEnPreambulo(filas: string[][]): string | null {
  const texto = filas.map((fila) => fila.join(" ")).join("\n");
  const escrita = texto.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/iu);
  if (!escrita) return null;
  const mes = MES_LISTADO[planaListado(escrita[2] ?? "")];
  const dia = (escrita[1] ?? "").padStart(2, "0");
  const iso = `${escrita[3]}-${mes ?? ""}-${dia}`;
  return fechaCalendario(iso) ? iso : null;
}

function fechaCalendario(iso: string): boolean {
  const corte = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!corte) return false;
  const anio = Number(corte[1]);
  const mes = Number(corte[2]);
  const dia = Number(corte[3]);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

function planaListado(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** CSV con comillas. Las fechas de los oficios no se leen: solo el preámbulo trae la del archivo. */
export function filasCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;
  const src = texto.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i += 1) {
    const caracter = src[i] ?? "";
    if (entreComillas) {
      if (caracter === '"') {
        if (src[i + 1] === '"') {
          celda += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        celda += caracter;
      }
      continue;
    }
    if (caracter === '"') {
      entreComillas = true;
      continue;
    }
    if (caracter === ",") {
      fila.push(celda);
      celda = "";
      continue;
    }
    if (caracter === "\n" || caracter === "\r") {
      if (caracter === "\r" && src[i + 1] === "\n") i += 1;
      fila.push(celda);
      celda = "";
      if (fila.some((valor) => valor.trim() !== "")) filas.push(fila);
      fila = [];
      continue;
    }
    celda += caracter;
  }

  if (celda.length > 0 || fila.length > 0) {
    fila.push(celda);
    if (fila.some((valor) => valor.trim() !== "")) filas.push(fila);
  }
  return filas;
}
