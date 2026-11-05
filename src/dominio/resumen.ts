export type PeriodoResumen = 6 | 12;

export type MesResumen = {
  clave: string;
  etiqueta: string;
  ingresosCentavos: number;
  gastosCentavos: number;
};

export type CategoriaResumen = {
  codigo: string;
  nombre: string;
  gastosCentavos: number;
};

export type MovimientoResumen = {
  id: string;
  motivo: string;
  categoria: string;
  centavos: number;
  ocurridoEn: string;
};

export type DatosResumenInicio = {
  saldoCentavos: number;
  mensuales: Omit<MesResumen, "etiqueta">[];
  categorias: CategoriaResumen[];
  recientes: MovimientoResumen[];
};

export type ResumenInicio = {
  periodo: PeriodoResumen;
  saldoCentavos: number;
  ingresosMesCentavos: number;
  gastosMesCentavos: number;
  resultadoMesCentavos: number;
  meses: MesResumen[];
  categorias: CategoriaResumen[];
  recientes: MovimientoResumen[];
  tieneMovimientos: boolean;
};

export function periodoResumen(valor: unknown): PeriodoResumen {
  return valor === "12" ? 12 : 6;
}

export function armarResumenInicio(
  datos: DatosResumenInicio,
  hoy: string,
  periodo: PeriodoResumen,
): ResumenInicio {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) throw new Error("fecha_invalida");
  const porMes = new Map(datos.mensuales.map((mes) => [mes.clave, mes]));
  const meses = mesesDelPeriodo(hoy, periodo).map(({ clave, etiqueta }) => {
    const encontrado = porMes.get(clave);
    return {
      clave,
      etiqueta,
      ingresosCentavos: centavosSeguros(encontrado?.ingresosCentavos ?? 0),
      gastosCentavos: centavosSeguros(encontrado?.gastosCentavos ?? 0),
    };
  });
  const actual = meses.at(-1) ?? { ingresosCentavos: 0, gastosCentavos: 0 };
  return {
    periodo,
    saldoCentavos: centavosSeguros(datos.saldoCentavos),
    ingresosMesCentavos: actual.ingresosCentavos,
    gastosMesCentavos: actual.gastosCentavos,
    resultadoMesCentavos: centavosSeguros(actual.ingresosCentavos - actual.gastosCentavos),
    meses,
    categorias: datos.categorias
      .filter((categoria) => categoria.gastosCentavos > 0)
      .map((categoria) => ({ ...categoria, gastosCentavos: centavosSeguros(categoria.gastosCentavos) }))
      .sort((a, b) => b.gastosCentavos - a.gastosCentavos || a.nombre.localeCompare(b.nombre, "es")),
    recientes: datos.recientes,
    tieneMovimientos: datos.recientes.length > 0 || datos.mensuales.length > 0,
  };
}

export function mesesDelPeriodo(hoy: string, periodo: PeriodoResumen): { clave: string; etiqueta: string }[] {
  const [anio, mes] = hoy.split("-").map(Number);
  if (!anio || !mes) throw new Error("fecha_invalida");
  return Array.from({ length: periodo }, (_, indice) => {
    const fecha = new Date(Date.UTC(anio, mes - 1 - (periodo - 1 - indice), 1));
    const clave = `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
    const texto = new Intl.DateTimeFormat("es-MX", {
      month: "short",
      year: periodo === 12 ? "2-digit" : undefined,
      timeZone: "UTC",
    }).format(fecha).replace(".", "");
    return { clave, etiqueta: texto.charAt(0).toLocaleUpperCase("es-MX") + texto.slice(1) };
  });
}

export function fechaMovimiento(valor: string): string {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error("fecha_invalida");
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Mexico_City",
  }).format(fecha).replace(".", "");
}

function centavosSeguros(valor: number): number {
  if (!Number.isSafeInteger(valor)) throw new Error("centavos_invalidos");
  return valor;
}
