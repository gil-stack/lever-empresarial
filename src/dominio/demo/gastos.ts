import { COMPRAS_DE_OCTUBRE } from "./movimientos";
import { congelar, type CifraDemo } from "./tipos";

export type RepartoDemo = { readonly nombre: string; readonly centavos: number; readonly porcentaje: number };

export type GastosDemo = {
  readonly gastadoCentavos: number;
  readonly comparacion: string;
  readonly mesAnterior: string;
  readonly cifras: readonly CifraDemo[];
  /** Gasto de cada día de octubre (1 a 31) en centavos; después de hoy, nulo. */
  readonly porDia: readonly (number | null)[];
  readonly hoy: number;
  readonly porArea: readonly RepartoDemo[];
  readonly porPersona: readonly RepartoDemo[];
  readonly porCategoria: readonly RepartoDemo[];
  readonly porComercio: readonly RepartoDemo[];
};

const HOY = 22;

function porDia(): (number | null)[] {
  const dias: (number | null)[] = Array.from({ length: 31 }, (_, i) => (i + 1 <= HOY ? 0 : null));
  for (const compra of COMPRAS_DE_OCTUBRE) dias[compra.dia - 1] = (dias[compra.dia - 1] ?? 0) + compra.centavos;
  return dias;
}

export const GASTOS_DEMO: GastosDemo = congelar({
  gastadoCentavos: 9842240,
  comparacion: "+16% vs septiembre",
  mesAnterior: "Septiembre: $85,060",
  cifras: [
    { rotulo: "Compras", valor: "34", nota: "Promedio $2,895" },
    { rotulo: "Al ritmo actual", valor: "$138,686", nota: "Cierre estimado de octubre, al día 22" },
    { rotulo: "Comprobado automático", valor: "80%", nota: "Sin que nadie tome una foto" },
    { rotulo: "IVA en riesgo", valor: "$0", nota: "0 gastos por comprobar" },
  ],
  porDia: porDia(),
  hoy: HOY,
  porArea: [
    { nombre: "Compras", centavos: 5570000, porcentaje: 57 },
    { nombre: "Operaciones", centavos: 1888000, porcentaje: 19 },
    { nombre: "Ventas", centavos: 1770000, porcentaje: 18 },
    { nombre: "Marketing", centavos: 387000, porcentaje: 4 },
    { nombre: "Tecnología", centavos: 227200, porcentaje: 2 },
  ],
  porPersona: [
    { nombre: "Daniela Ruiz", centavos: 5570000, porcentaje: 57 },
    { nombre: "Carlos Méndez", centavos: 1888000, porcentaje: 19 },
    { nombre: "Ana Torres", centavos: 1770000, porcentaje: 18 },
    { nombre: "Eduardo", centavos: 614200, porcentaje: 6 },
  ],
  porCategoria: [
    { nombre: "Materiales", centavos: 2303700, porcentaje: 23 },
    { nombre: "Insumos", centavos: 1746200, porcentaje: 18 },
    { nombre: "Combustible", centavos: 1740000, porcentaje: 18 },
    { nombre: "Transporte", centavos: 1066500, porcentaje: 11 },
    { nombre: "Papelería", centavos: 990400, porcentaje: 10 },
    { nombre: "Mobiliario y equipo", centavos: 589000, porcentaje: 6 },
  ],
  porComercio: [
    { nombre: "The Home Depot", centavos: 2244500, porcentaje: 23 },
    { nombre: "Office Depot", centavos: 990400, porcentaje: 10 },
    { nombre: "Pemex · Gasolinera 4512", centavos: 912000, porcentaje: 9 },
    { nombre: "Aeroméxico", centavos: 884000, porcentaje: 9 },
    { nombre: "Costco", centavos: 873600, porcentaje: 9 },
    { nombre: "Amazon México", centavos: 872500, porcentaje: 9 },
  ],
});
