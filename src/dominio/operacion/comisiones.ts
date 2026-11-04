export type TipoComision = "fondeo" | "spei";

export type ComisionNormalizada = {
  tipo: TipoComision;
  valor: number;
  moneda: "MXN" | null;
  vigenteDesde: string;
};

/** Enteros de la interfaz a la unidad persistida: bp o centavos, nunca flotantes. */
export function normalizarComision(entrada: {
  tipo?: unknown;
  valor?: unknown;
  vigenteDesde?: unknown;
}, hoy: string): ComisionNormalizada {
  if (entrada.tipo !== "fondeo" && entrada.tipo !== "spei") throw new Error("comision_tipo_invalido");
  const crudo = typeof entrada.valor === "string" ? entrada.valor.trim() : "";
  if (!/^\d{1,16}$/.test(crudo)) throw new Error("comision_valor_invalido");
  const valor = Number(crudo);
  if (!Number.isSafeInteger(valor) || valor < 0 || (entrada.tipo === "fondeo" && valor > 10_000)) {
    throw new Error("comision_valor_invalido");
  }
  if (typeof entrada.vigenteDesde !== "string" || !fechaValida(entrada.vigenteDesde)) {
    throw new Error("vigencia_invalida");
  }
  if (entrada.vigenteDesde < hoy) throw new Error("vigencia_en_pasado");
  return {
    tipo: entrada.tipo,
    valor,
    moneda: entrada.tipo === "spei" ? "MXN" : null,
    vigenteDesde: entrada.vigenteDesde,
  };
}

export function fechaValida(valor: string): boolean {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!coincidencia) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

export function hoyEnMexico(ahora: Date): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

export function diaAnterior(fecha: string): string {
  if (!fechaValida(fecha)) throw new Error("vigencia_invalida");
  const anterior = new Date(`${fecha}T00:00:00.000Z`);
  anterior.setUTCDate(anterior.getUTCDate() - 1);
  return anterior.toISOString().slice(0, 10);
}

export function textoComision(tipo: TipoComision, valor: number): string {
  if (tipo === "fondeo") return `${(valor / 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })} % (${valor} bp)`;
  return `${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(valor / 100)} MXN`;
}
