export type TipoPersona = "fisica" | "moral";

type Regimen = {
  codigo: string;
  fisica: boolean;
  moral: boolean;
};

type Uso = {
  fisica: boolean;
  moral: boolean;
  regimenes: readonly string[];
};

// c_RegimenFiscal del anexo 20, catálogos CFDI 4.0 publicados el 15 de octubre de 2026.
const REGIMENES: readonly Regimen[] = [
  { codigo: "601", fisica: false, moral: true },
  { codigo: "603", fisica: false, moral: true },
  { codigo: "605", fisica: true, moral: false },
  { codigo: "606", fisica: true, moral: false },
  { codigo: "607", fisica: true, moral: false },
  { codigo: "608", fisica: true, moral: false },
  { codigo: "610", fisica: true, moral: true },
  { codigo: "611", fisica: true, moral: false },
  { codigo: "612", fisica: true, moral: false },
  { codigo: "614", fisica: true, moral: false },
  { codigo: "615", fisica: true, moral: false },
  { codigo: "616", fisica: true, moral: false },
  { codigo: "620", fisica: false, moral: true },
  { codigo: "621", fisica: true, moral: false },
  { codigo: "622", fisica: false, moral: true },
  { codigo: "623", fisica: false, moral: true },
  { codigo: "624", fisica: false, moral: true },
  { codigo: "625", fisica: true, moral: false },
  { codigo: "626", fisica: true, moral: true },
];

const GASTO = ["601", "603", "606", "612", "620", "621", "622", "623", "624", "625", "626"] as const;
const DEVOLUCION = ["601", "603", "606", "612", "616", "620", "621", "622", "623", "624", "625", "626"] as const;
const DEDUCCION = ["605", "606", "607", "608", "611", "612", "614", "615", "625"] as const;
const TODOS = REGIMENES.map((regimen) => regimen.codigo);

const USOS: Record<string, Uso> = {
  G01: ambos(GASTO),
  G02: ambos(DEVOLUCION),
  G03: ambos(GASTO),
  I01: ambos(GASTO),
  I02: ambos(GASTO),
  I03: ambos(GASTO),
  I04: ambos(GASTO),
  I05: ambos(GASTO),
  I06: ambos(GASTO),
  I07: ambos(GASTO),
  I08: ambos(GASTO),
  S01: ambos(TODOS),
  CP01: ambos(TODOS),
  CN01: soloFisica(["605"]),
};

for (const codigo of ["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D10"]) {
  USOS[codigo] = soloFisica(DEDUCCION);
}

export function tipoDePersona(rfc: string): TipoPersona {
  return rfc.length === 12 ? "moral" : "fisica";
}

export function regimenAplica(codigo: string, tipo: TipoPersona): boolean {
  const regimen = REGIMENES.find((item) => item.codigo === codigo);
  if (!regimen) return false;
  return tipo === "fisica" ? regimen.fisica : regimen.moral;
}

export function usoAplica(uso: string, tipo: TipoPersona, regimen: string): boolean {
  const fila = USOS[uso];
  if (!fila) return false;
  if (tipo === "fisica" ? !fila.fisica : !fila.moral) return false;
  return fila.regimenes.includes(regimen);
}

function ambos(regimenes: readonly string[]): Uso {
  return { fisica: true, moral: true, regimenes };
}

function soloFisica(regimenes: readonly string[]): Uso {
  return { fisica: true, moral: false, regimenes };
}
