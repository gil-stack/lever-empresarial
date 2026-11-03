import { regimenFueraDeCuenta, usoFueraDeCuenta } from "../domain/recorte";
import type { TipoPersona } from "./rfc";

export type RegimenFiscal = {
  codigo: string;
  nombre: string;
  fisica: boolean;
  moral: boolean;
};

export type UsoCfdi = {
  codigo: string;
  nombre: string;
  fisica: boolean;
  moral: boolean;
  regimenes: readonly string[];
};

/**
 * Catálogo c_RegimenFiscal del CFDI 4.0.
 * 621 sigue citado por el catálogo de usos vigente a octubre de 2026.
 */
export const REGIMENES: readonly RegimenFiscal[] = [
  { codigo: "601", nombre: "General de Ley Personas Morales", fisica: false, moral: true },
  { codigo: "603", nombre: "Personas Morales con Fines no Lucrativos", fisica: false, moral: true },
  { codigo: "605", nombre: "Sueldos y Salarios e Ingresos Asimilados a Salarios", fisica: true, moral: false },
  { codigo: "606", nombre: "Arrendamiento", fisica: true, moral: false },
  { codigo: "607", nombre: "Régimen de Enajenación o Adquisición de Bienes", fisica: true, moral: false },
  { codigo: "608", nombre: "Demás ingresos", fisica: true, moral: false },
  {
    codigo: "610",
    nombre: "Residentes en el Extranjero sin Establecimiento Permanente en México",
    fisica: true,
    moral: true,
  },
  { codigo: "611", nombre: "Ingresos por Dividendos (socios y accionistas)", fisica: true, moral: false },
  {
    codigo: "612",
    nombre: "Personas Físicas con Actividades Empresariales y Profesionales",
    fisica: true,
    moral: false,
  },
  { codigo: "614", nombre: "Ingresos por intereses", fisica: true, moral: false },
  { codigo: "615", nombre: "Régimen de los ingresos por obtención de premios", fisica: true, moral: false },
  { codigo: "616", nombre: "Sin obligaciones fiscales", fisica: true, moral: false },
  {
    codigo: "620",
    nombre: "Sociedades Cooperativas de Producción que optan por diferir sus ingresos",
    fisica: false,
    moral: true,
  },
  { codigo: "621", nombre: "Incorporación Fiscal", fisica: true, moral: false },
  {
    codigo: "622",
    nombre: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",
    fisica: false,
    moral: true,
  },
  { codigo: "623", nombre: "Opcional para Grupos de Sociedades", fisica: false, moral: true },
  { codigo: "624", nombre: "Coordinados", fisica: false, moral: true },
  {
    codigo: "625",
    nombre: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas",
    fisica: true,
    moral: false,
  },
  { codigo: "626", nombre: "Régimen Simplificado de Confianza", fisica: true, moral: true },
];

const DEDUCCIONES_FISICA = ["605", "606", "608", "611", "612", "614", "607", "615", "625"] as const;
const GASTOS = ["601", "603", "606", "612", "620", "621", "622", "623", "624", "625", "626"] as const;
const GASTOS_Y_SIN_OBLIGACIONES = [
  "601",
  "603",
  "606",
  "612",
  "616",
  "620",
  "621",
  "622",
  "623",
  "624",
  "625",
  "626",
] as const;
const AMPLIO = [
  "601",
  "603",
  "605",
  "606",
  "608",
  "610",
  "611",
  "612",
  "614",
  "616",
  "620",
  "621",
  "622",
  "623",
  "624",
  "607",
  "615",
  "625",
  "626",
] as const;

/** Catálogo c_UsoCFDI del CFDI 4.0, con el cruce que el SAT publica contra el régimen. */
export const USOS: readonly UsoCfdi[] = [
  { codigo: "G01", nombre: "Adquisición de mercancías", fisica: true, moral: true, regimenes: GASTOS },
  {
    codigo: "G02",
    nombre: "Devoluciones, descuentos o bonificaciones",
    fisica: true,
    moral: true,
    regimenes: GASTOS_Y_SIN_OBLIGACIONES,
  },
  { codigo: "G03", nombre: "Gastos en general", fisica: true, moral: true, regimenes: GASTOS },
  { codigo: "I01", nombre: "Construcciones", fisica: true, moral: true, regimenes: GASTOS },
  {
    codigo: "I02",
    nombre: "Mobiliario y equipo de oficina por inversiones",
    fisica: true,
    moral: true,
    regimenes: GASTOS,
  },
  { codigo: "I03", nombre: "Equipo de transporte", fisica: true, moral: true, regimenes: GASTOS },
  {
    codigo: "I04",
    nombre: "Equipo de computo y accesorios",
    fisica: true,
    moral: true,
    regimenes: GASTOS,
  },
  {
    codigo: "I05",
    nombre: "Dados, troqueles, moldes, matrices y herramental",
    fisica: true,
    moral: true,
    regimenes: GASTOS,
  },
  { codigo: "I06", nombre: "Comunicaciones telefónicas", fisica: true, moral: true, regimenes: GASTOS },
  { codigo: "I07", nombre: "Comunicaciones satelitales", fisica: true, moral: true, regimenes: GASTOS },
  { codigo: "I08", nombre: "Otra maquinaria y equipo", fisica: true, moral: true, regimenes: GASTOS },
  {
    codigo: "D01",
    nombre: "Honorarios médicos, dentales y gastos hospitalarios",
    fisica: true,
    moral: false,
    regimenes: DEDUCCIONES_FISICA,
  },
  {
    codigo: "D02",
    nombre: "Gastos médicos por incapacidad o discapacidad",
    fisica: true,
    moral: false,
    regimenes: DEDUCCIONES_FISICA,
  },
  { codigo: "D03", nombre: "Gastos funerales", fisica: true, moral: false, regimenes: DEDUCCIONES_FISICA },
  { codigo: "D04", nombre: "Donativos", fisica: true, moral: false, regimenes: DEDUCCIONES_FISICA },
  {
    codigo: "D05",
    nombre: "Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)",
    fisica: true,
    moral: false,
    regimenes: DEDUCCIONES_FISICA,
  },
  {
    codigo: "D06",
    nombre: "Aportaciones voluntarias al SAR",
    fisica: true,
    moral: false,
    regimenes: DEDUCCIONES_FISICA,
  },
  {
    codigo: "D07",
    nombre: "Primas por seguros de gastos médicos",
    fisica: true,
    moral: false,
    regimenes: DEDUCCIONES_FISICA,
  },
  {
    codigo: "D08",
    nombre: "Gastos de transportación escolar obligatoria",
    fisica: true,
    moral: false,
    regimenes: DEDUCCIONES_FISICA,
  },
  {
    codigo: "D09",
    nombre: "Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones",
    fisica: true,
    moral: false,
    regimenes: DEDUCCIONES_FISICA,
  },
  {
    codigo: "D10",
    nombre: "Pagos por servicios educativos (colegiaturas)",
    fisica: true,
    moral: false,
    regimenes: DEDUCCIONES_FISICA,
  },
  { codigo: "S01", nombre: "Sin efectos fiscales", fisica: true, moral: true, regimenes: AMPLIO },
  { codigo: "CP01", nombre: "Pagos", fisica: true, moral: true, regimenes: AMPLIO },
  { codigo: "CN01", nombre: "Nómina", fisica: true, moral: false, regimenes: ["605"] },
];

const REGIMEN_POR_CODIGO = new Map(REGIMENES.map((regimen) => [regimen.codigo, regimen]));
const USO_POR_CODIGO = new Map(USOS.map((uso) => [uso.codigo, uso]));

export function regimenPorCodigo(codigo: string): RegimenFiscal | null {
  return REGIMEN_POR_CODIGO.get(codigo) ?? null;
}

export function usoPorCodigo(codigo: string): UsoCfdi | null {
  return USO_POR_CODIGO.get(codigo) ?? null;
}

export function regimenesVisibles(tipo: TipoPersona | null): readonly RegimenFiscal[] {
  const entran = REGIMENES.filter((regimen) => !regimenFueraDeCuenta(regimen.codigo));
  if (tipo === "fisica") return entran.filter((regimen) => regimen.fisica);
  if (tipo === "moral") return entran.filter((regimen) => regimen.moral);
  return entran;
}

export function usosVisibles(tipo: TipoPersona | null, regimen: string): readonly UsoCfdi[] {
  return USOS.filter((uso) => {
    if (usoFueraDeCuenta(uso.codigo)) return false;
    if (tipo === "fisica" && !uso.fisica) return false;
    if (tipo === "moral" && !uso.moral) return false;
    if (regimen && !uso.regimenes.includes(regimen)) return false;
    return true;
  });
}
