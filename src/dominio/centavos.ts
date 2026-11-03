/**
 * El libro guarda centavos enteros. La persona escribe pesos, con centavos.
 * Vacío no es cero: vacío significa que la empresa todavía no escribió el monto.
 */

export type CentavosLeidos =
  | { tipo: "vacio" }
  | { tipo: "centavos"; centavos: number }
  | { tipo: "invalido" };

export function leerCentavosEscritos(valor: unknown): CentavosLeidos {
  if (typeof valor !== "string") return { tipo: "invalido" };
  let texto = valor.trim();
  if (texto.length === 0) return { tipo: "vacio" };
  if (texto.toLowerCase().endsWith("mxn")) texto = texto.slice(0, -3).trim();
  if (texto.startsWith("$")) texto = texto.slice(1).trim();
  if (texto.length === 0 || /\s/.test(texto) || /[^0-9.,]/.test(texto)) return { tipo: "invalido" };

  const partes = partir(texto);
  if (!partes) return { tipo: "invalido" };
  if (partes.entero.length === 0 || partes.entero.length > 15) return { tipo: "invalido" };

  const pesos = Number(partes.entero);
  const fraccion = (partes.fraccion + "00").slice(0, 2);
  const cents = Number(fraccion);
  if (!Number.isSafeInteger(pesos) || !Number.isSafeInteger(cents)) return { tipo: "invalido" };
  const total = pesos * 100 + cents;
  if (!Number.isSafeInteger(total)) return { tipo: "invalido" };
  return { tipo: "centavos", centavos: total };
}

export function formatoPesos(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new Error("centavos_invalidos");
  }
  const negativo = centavos < 0;
  const absoluto = Math.abs(centavos);
  const pesos = Math.trunc(absoluto / 100);
  const resto = absoluto % 100;
  const grupos = new Intl.NumberFormat("es-MX", {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(pesos);
  return `${negativo ? "-" : ""}$${grupos}.${String(resto).padStart(2, "0")}`;
}

function partir(texto: string): { entero: string; fraccion: string } | null {
  const tienePunto = texto.includes(".");
  const tieneComa = texto.includes(",");
  if (!tienePunto && !tieneComa) {
    return /^\d+$/.test(texto) ? { entero: texto, fraccion: "" } : null;
  }
  if (tienePunto && tieneComa) {
    const decimal = texto.lastIndexOf(".") > texto.lastIndexOf(",") ? "." : ",";
    const miles = decimal === "." ? "," : ".";
    const corte = texto.lastIndexOf(decimal);
    const fraccion = texto.slice(corte + 1);
    const entero = texto.slice(0, corte);
    if (!/^\d{1,2}$/.test(fraccion)) return null;
    if (!esGrupoDeMiles(entero, miles) && !/^\d+$/.test(entero)) return null;
    if (entero.includes(miles) && !esGrupoDeMiles(entero, miles)) return null;
    return { entero: soloDigitos(entero), fraccion };
  }
  const separador = tienePunto ? "." : ",";
  if (esGrupoDeMiles(texto, separador)) {
    return { entero: soloDigitos(texto), fraccion: "" };
  }
  const corte = texto.lastIndexOf(separador);
  if (texto.indexOf(separador) !== corte) return null;
  const fraccion = texto.slice(corte + 1);
  const entero = texto.slice(0, corte);
  if (!/^\d{1,2}$/.test(fraccion) || !/^\d+$/.test(entero)) return null;
  return { entero, fraccion };
}

function esGrupoDeMiles(texto: string, separador: "." | ","): boolean {
  const patron = separador === "." ? /^\d{1,3}(\.\d{3})+$/ : /^\d{1,3}(,\d{3})+$/;
  if (!patron.test(texto)) return false;
  const primero = texto.split(separador)[0] ?? "";
  return primero !== "0";
}

function soloDigitos(texto: string): string {
  return texto.replace(/[.,]/g, "");
}
