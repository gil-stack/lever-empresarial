import { normalizarReferencia, referenciaValida } from "./referencia";

/**
 * Del estado de cuenta crudo (una tabla) a los abonos que la empresa recibió.
 * Qué columna es qué lo dice el empate, que se recuerda por banco. Puro: la
 * huella (SHA-256 de la clave de cada renglón) la saca el servidor.
 */

export type Celda = string | number | null;

export const BANCOS = [
  { clave: "bbva", nombre: "BBVA" },
  { clave: "banorte", nombre: "Banorte" },
  { clave: "santander", nombre: "Santander" },
  { clave: "banamex", nombre: "Banamex" },
  { clave: "hsbc", nombre: "HSBC" },
  { clave: "scotiabank", nombre: "Scotiabank" },
  { clave: "banbajio", nombre: "BanBajío" },
  { clave: "inbursa", nombre: "Inbursa" },
  { clave: "banregio", nombre: "Banregio" },
  { clave: "afirme", nombre: "Afirme" },
  { clave: "otro", nombre: "Otro banco" },
] as const;
export type ClaveBanco = (typeof BANCOS)[number]["clave"];

/**
 * Un archivo nuevo cuyos abonos ya estaban todos en Lever: no se asentó nada, así que no se dice «Quedó asentado»
 * (r63b-N3), y el número concuerda con el verbo.
 */
export function avisoSinNuevos(repetidos: number): { titulo: string; mensaje: string } {
  const abonos = repetidos === 1 ? "Su único abono ya estaba en Lever" : `Sus ${repetidos} abonos ya estaban en Lever`;
  return { titulo: "No había nada nuevo", mensaje: `${abonos}: no se importó ni se duplicó nada.` };
}

export function esBanco(valor: unknown): valor is ClaveBanco {
  return BANCOS.some((b) => b.clave === valor);
}

export const CAMPOS_EMPATE = ["fecha", "abono", "concepto", "referencia", "rastreo"] as const;
export type CampoEmpate = (typeof CAMPOS_EMPATE)[number];
export const ETIQUETA_CAMPO: Readonly<Record<CampoEmpate, string>> = {
  fecha: "Fecha",
  abono: "Abono (lo que entró)",
  concepto: "Concepto o descripción",
  referencia: "Referencia",
  rastreo: "Clave de rastreo",
};

export type Empate = {
  filaEncabezado: number;
  columnas: { fecha: number; abono: number; concepto: number | null; referencia: number | null; rastreo: number | null };
};

const PISTAS: Readonly<Record<CampoEmpate, RegExp>> = {
  fecha: /^fecha( de)?( (operaci[oó]n|movimiento|aplicaci[oó]n))?$|^fecha|^date/i,
  abono: /abono|dep[oó]sito|cr[eé]dito|ingreso|entrada/i,
  concepto: /concepto|descripci[oó]n|detalle|movimiento/i,
  referencia: /referencia|ref\.?( num[eé]rica)?$/i,
  rastreo: /rastreo/i,
};

/** El renglón de encabezados y las columnas que parecen ser cada cosa. Si no se reconoce, nulo. */
export function sugerirEmpate(tabla: readonly (readonly Celda[])[]): Empate | null {
  for (let fila = 0; fila < Math.min(tabla.length, 30); fila += 1) {
    const textos = (tabla[fila] ?? []).map((c) => (typeof c === "string" ? c.trim() : ""));
    const buscar = (campo: CampoEmpate, excepto: readonly number[] = []) =>
      textos.findIndex((t, i) => t !== "" && !excepto.includes(i) && PISTAS[campo].test(t));
    const fecha = buscar("fecha");
    const abono = buscar("abono", [fecha]);
    if (fecha < 0 || abono < 0) continue;
    const rastreo = buscar("rastreo", [fecha, abono]);
    const referencia = buscar("referencia", [fecha, abono, rastreo]);
    const concepto = buscar("concepto", [fecha, abono, rastreo, referencia]);
    const nulo = (n: number) => (n < 0 ? null : n);
    return { filaEncabezado: fila, columnas: { fecha, abono, concepto: nulo(concepto), referencia: nulo(referencia), rastreo: nulo(rastreo) } };
  }
  return null;
}

const MESES: Readonly<Record<string, number>> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

function fechaIso(anio: number, mes: number, dia: number): string | null {
  if (anio < 2000 || anio > 2099 || mes < 1 || mes > 12 || dia < 1) return null;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  if (dia > ultimo) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Fechas como las exportan los bancos en México: día primero (15/11/2026,
 * 15-11-26, 15.11.2026), con el mes en letras (15/NOV/2026, 15 nov 2026), ISO
 * (2026-11-15) o el número de serie de Excel (46341 = 15 nov 2026).
 */
export function leerFecha(celda: Celda): string | null {
  if (typeof celda === "number") {
    // Serie de Excel (sistema 1900): días desde el 30 dic 1899. 36526 = 1 ene 2000; 73050 = 31 dic 2099.
    if (!Number.isFinite(celda) || celda < 36526 || celda > 73050) return null;
    const fecha = new Date(Date.UTC(1899, 11, 30) + Math.floor(celda) * 86_400_000);
    return fecha.toISOString().slice(0, 10);
  }
  if (typeof celda !== "string") return null;
  const t = celda.trim().toLowerCase().replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t].*)?$/.exec(t);
  if (m) return fechaIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?: .*)?$/.exec(t);
  if (m) {
    const anio = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return fechaIso(anio, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[/ .-]([a-z]{3})[a-z]*\.?[/ .-](\d{2}|\d{4})(?: .*)?$/.exec(t);
  if (m && MESES[m[2]!]) {
    const anio = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return fechaIso(anio, MESES[m[2]!]!, Number(m[1]));
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) return leerFecha(Number(t));
  return null;
}

const TOPE_CENTAVOS = 9_000_000_000_000_000;

/**
 * Montos como en México: $1,234.56, 1234.56, «1,234.56 MXN», (1,234.56) o
 * -1,234.56 (negativo). Si trae coma decimal (1.234,56 o 1234,56) también se
 * entiende. Devuelve centavos (con signo) o nulo si no es un monto.
 */
export function leerMonto(celda: Celda): number | null {
  if (typeof celda === "number") {
    if (!Number.isFinite(celda)) return null;
    const c = Math.round(celda * 100);
    return Math.abs(c) <= TOPE_CENTAVOS ? c : null;
  }
  if (typeof celda !== "string") return null;
  let t = celda.trim().replace(/\s+/g, "").replace(/mxn|mn|\$/gi, "");
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith("-")) {
    negativo = !negativo;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  if (!/^[0-9.,]+$/.test(t) || !/[0-9]/.test(t)) return null;
  const punto = t.lastIndexOf(".");
  const coma = t.lastIndexOf(",");
  let entero: string;
  let decimales = "";
  if (punto >= 0 && coma >= 0) {
    const decimal = punto > coma ? "." : ",";
    const i = t.lastIndexOf(decimal);
    entero = t.slice(0, i).replace(/[.,]/g, "");
    decimales = t.slice(i + 1);
  } else if (coma >= 0 && /^[0-9]+,[0-9]{1,2}$/.test(t)) {
    [entero, decimales] = t.split(",") as [string, string];
  } else if (punto >= 0 && (t.match(/\./g) ?? []).length === 1 && !/^[0-9]{1,3}\.[0-9]{3}$/.test(t)) {
    [entero, decimales] = t.split(".") as [string, string];
  } else {
    entero = t.replace(/[.,]/g, "");
  }
  // Lo que queda antes del decimal: dígitos solos o en grupos de tres (1,234,567 o 1.234.567).
  const parteEntera = t.slice(0, t.length - (decimales === "" ? 0 : decimales.length + 1));
  if (!/^[0-9]+$/.test(parteEntera) && !/^[0-9]{1,3}([.,][0-9]{3})+$/.test(parteEntera)) return null;
  if (!/^[0-9]{1,16}$/.test(entero) || !/^[0-9]{0,2}$/.test(decimales)) return null;
  const centavos = Number(entero) * 100 + Number(decimales.padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos) || centavos > TOPE_CENTAVOS) return null;
  return negativo ? -centavos : centavos;
}

/** La referencia de Lever (7 dígitos con su verificador) dentro de un texto, si está una sola vez. */
export function referenciaEnTexto(texto: string | null): string | null {
  if (!texto) return null;
  const encontradas = [...new Set((texto.match(/(?<![0-9])[0-9]{7}(?![0-9])/g) ?? []).filter(referenciaValida))];
  return encontradas.length === 1 ? encontradas[0]! : null;
}

/** La referencia de Lever de un renglón: la columna de referencia (o lo que diga) y, si no, el concepto. */
export function referenciaDeRenglon(referencia: string | null, concepto: string | null): string | null {
  return normalizarReferencia(referencia) ?? referenciaEnTexto(referencia) ?? referenciaEnTexto(concepto);
}

export type RenglonLeido = {
  /** Índice en la tabla, para señalar el renglón al usuario. */
  fila: number;
  fecha: string;
  montoCentavos: number;
  concepto: string | null;
  /** Lo que trae la columna de referencia (texto libre del banco). */
  referencia: string | null;
  /** La referencia de Lever, si se reconoce en la columna o en el concepto. */
  referenciaLever: string | null;
  rastreo: string | null;
  /** Lo que identifica al renglón; el servidor guarda su SHA-256. */
  clave: string;
};

export type Lectura = { renglones: number; abonos: RenglonLeido[]; sinFecha: number; futuros: number };

function texto(celda: Celda | undefined, tope: number): string | null {
  if (celda === null || celda === undefined) return null;
  const t = String(celda).normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t === "" ? null : t.slice(0, tope);
}

/** Un texto que una hoja de cálculo leería como fórmula se guarda neutralizado. */
export function sinFormula(t: string | null): string | null {
  return t && /^[=+\-@]/.test(t) ? `'${t}` : t;
}

export function aplicarEmpate(tabla: readonly (readonly Celda[])[], empate: Empate, hoy: string): Lectura {
  const { columnas } = empate;
  const abonos: RenglonLeido[] = [];
  const vistas = new Map<string, number>();
  let renglones = 0;
  let sinFecha = 0;
  let futuros = 0;
  for (let fila = empate.filaEncabezado + 1; fila < tabla.length; fila += 1) {
    const r = tabla[fila] ?? [];
    if (r.every((c) => c === null)) continue;
    renglones += 1;
    const monto = leerMonto(r[columnas.abono] ?? null);
    if (monto === null || monto <= 0) continue;
    const fecha = leerFecha(r[columnas.fecha] ?? null);
    if (!fecha) {
      sinFecha += 1;
      continue;
    }
    if (fecha > hoy) {
      futuros += 1;
      continue;
    }
    const concepto = sinFormula(texto(columnas.concepto === null ? null : r[columnas.concepto], 500));
    const referencia = sinFormula(texto(columnas.referencia === null ? null : r[columnas.referencia], 120));
    const rastreoCrudo = texto(columnas.rastreo === null ? null : r[columnas.rastreo], 60)?.replace(/\s/g, "") ?? null;
    const rastreo = rastreoCrudo && /^[A-Za-z0-9]{1,30}$/.test(rastreoCrudo) ? rastreoCrudo.toUpperCase() : null;
    const referenciaLever = referenciaDeRenglon(referencia, concepto);
    // La identidad del abono: fecha, monto y el texto normalizado de las demás celdas del renglón (donde vienen el
    // concepto, la referencia y la clave de rastreo), ordenado. No entra el banco (la cuenta es una sola CLABE de la
    // empresa) ni qué columna se eligió para qué: el mismo depósito leído con otro banco u otro empate es el mismo
    // renglón (r63-N1).
    const resto = r
      .filter((_, i) => i !== columnas.fecha && i !== columnas.abono)
      .map((c) => texto(c, 500)?.toLowerCase() ?? null)
      .filter((t): t is string => t !== null)
      .sort();
    const base = [fecha, monto, ...resto].join("\u001f");
    // Dos depósitos idénticos el mismo día en el mismo archivo son dos renglones; volver a subirlo da las mismas claves.
    const ocurrencia = vistas.get(base) ?? 0;
    vistas.set(base, ocurrencia + 1);
    abonos.push({ fila, fecha, montoCentavos: monto, concepto, referencia, referenciaLever, rastreo, clave: `${base}|${ocurrencia}` });
  }
  return { renglones, abonos, sinFecha, futuros };
}

/** El empate que escribió la persona, ya validado contra la tabla. */
export function validarEmpate(entrada: Record<string, unknown>, columnasDeLaTabla: number, renglonesDeLaTabla: number): Empate | { error: string; campo: string } {
  const indice = (campo: string, requerido: boolean): number | null | "error" => {
    const v = entrada[campo];
    if (v === undefined || v === null || v === "") return requerido ? "error" : null;
    const n = typeof v === "string" && /^[0-9]{1,2}$/.test(v) ? Number(v) : Number.NaN;
    return Number.isInteger(n) && n >= 0 && n < columnasDeLaTabla ? n : "error";
  };
  const fila = typeof entrada.filaEncabezado === "string" && /^[0-9]{1,2}$/.test(entrada.filaEncabezado) ? Number(entrada.filaEncabezado) : Number.NaN;
  if (!Number.isInteger(fila) || fila < 0 || fila > 50 || fila >= renglonesDeLaTabla) return { campo: "filaEncabezado", error: "Elige el renglón donde están los títulos de las columnas." };
  const fecha = indice("columnaFecha", true);
  const abono = indice("columnaAbono", true);
  if (fecha === "error" || fecha === null) return { campo: "columnaFecha", error: "Elige la columna de la fecha." };
  if (abono === "error" || abono === null) return { campo: "columnaAbono", error: "Elige la columna del abono (lo que entró)." };
  if (fecha === abono) return { campo: "columnaAbono", error: "La fecha y el abono no pueden ser la misma columna." };
  const concepto = indice("columnaConcepto", false);
  const referencia = indice("columnaReferencia", false);
  const rastreo = indice("columnaRastreo", false);
  if (concepto === "error" || referencia === "error" || rastreo === "error") return { campo: "columnaConcepto", error: "Una de las columnas elegidas no existe en el archivo." };
  return { filaEncabezado: fila, columnas: { fecha, abono, concepto, referencia, rastreo } };
}
