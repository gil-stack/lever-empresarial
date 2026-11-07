import { congelar, type CifraDemo, type EstadoDemo } from "./tipos";

/** Una tarjeta precargada del diseño. En el producto serán de Efevoo; hoy no hay integración. */
export type TarjetaDemo = {
  readonly nombre: string;
  readonly terminacion: string;
  readonly forma: string;
  readonly titular: string;
  readonly area: string;
  /** Nulo = sin tope. */
  readonly presupuestoCentavos: number | null;
  readonly gastadoCentavos: number;
  readonly saldoCentavos: number;
  readonly estado: EstadoDemo;
  readonly destacada: boolean;
};

/** Un área en «Presupuestos por área» (budgetsView del diseño, proyección con los primeros 22 días). */
export type PresupuestoAreaDemo = {
  readonly area: string;
  readonly gastadoCentavos: number;
  readonly presupuestoCentavos: number;
  /** Suma de los límites mensuales de sus tarjetas activas. */
  readonly repartidoCentavos: number;
  readonly nota: string;
  readonly alerta: boolean;
};

export type TarjetasDemo = {
  readonly cifras: readonly CifraDemo[];
  readonly tarjetas: readonly TarjetaDemo[];
  readonly cifrasPresupuesto: readonly CifraDemo[];
  readonly presupuestos: readonly PresupuestoAreaDemo[];
  readonly proyeccion: string;
};

const activa: EstadoDemo = { texto: "Activa", tono: "acento" };

export const TARJETAS_DEMO: TarjetasDemo = congelar({
  cifras: [
    { rotulo: "Tarjetas activas", valor: "8", nota: "3 virtuales por comercio" },
    { rotulo: "Saldo asignado", valor: "$320,878", nota: "Repartido entre las tarjetas" },
    { rotulo: "Gastado este mes", valor: "$98,422", nota: "Todas las tarjetas" },
    { rotulo: "Cerca del límite", valor: "0", nota: "Al 85% o más de su límite" },
  ],
  tarjetas: [
    { nombre: "Lever Silver", terminacion: "6767", forma: "Física y digital", titular: "Eduardo", area: "Comercial", presupuestoCentavos: null, gastadoCentavos: 2512220, saldoCentavos: 18425060, estado: activa, destacada: true },
    { nombre: "Viáticos", terminacion: "4410", forma: "Física", titular: "Eduardo", area: "Comercial", presupuestoCentavos: 4000000, gastadoCentavos: 1845000, saldoCentavos: 2155000, estado: activa, destacada: false },
    { nombre: "Viáticos", terminacion: "2291", forma: "Física", titular: "Ana Torres", area: "Ventas", presupuestoCentavos: 3000000, gastadoCentavos: 1770000, saldoCentavos: 1230000, estado: activa, destacada: false },
    { nombre: "Combustible", terminacion: "8833", forma: "Física", titular: "Carlos Méndez", area: "Operaciones", presupuestoCentavos: 2500000, gastadoCentavos: 1888000, saldoCentavos: 612000, estado: activa, destacada: false },
    { nombre: "Compras", terminacion: "5170", forma: "Física y digital", titular: "Daniela Ruiz", area: "Compras", presupuestoCentavos: 12000000, gastadoCentavos: 5570000, saldoCentavos: 6430000, estado: activa, destacada: true },
    { nombre: "Viáticos", terminacion: "3305", forma: "Física", titular: "Jorge Salas", area: "Logística", presupuestoCentavos: 3000000, gastadoCentavos: 0, saldoCentavos: 3000000, estado: { texto: "Congelada", tono: "peligro" }, destacada: false },
    { nombre: "Virtual · AWS", terminacion: "1182", forma: "Virtual", titular: "Eduardo", area: "Tecnología", presupuestoCentavos: 150000, gastadoCentavos: 81240, saldoCentavos: 68760, estado: activa, destacada: false },
    { nombre: "Virtual · Google Workspace", terminacion: "7740", forma: "Virtual", titular: "Eduardo", area: "Tecnología", presupuestoCentavos: 200000, gastadoCentavos: 146000, saldoCentavos: 54000, estado: activa, destacada: false },
    { nombre: "Virtual · Meta Ads", terminacion: "3365", forma: "Virtual", titular: "Eduardo", area: "Marketing", presupuestoCentavos: 500000, gastadoCentavos: 387000, saldoCentavos: 113000, estado: activa, destacada: false },
  ],
  cifrasPresupuesto: [
    { rotulo: "Presupuesto de octubre", valor: "$215,000", nota: "Suma de las áreas" },
    { rotulo: "Repartido en tarjetas", valor: "$253,500", nota: "Límites mensuales de las tarjetas activas" },
    { rotulo: "Gastado", valor: "$141,995", nota: "66% del presupuesto" },
    { rotulo: "Áreas en riesgo", valor: "2", nota: "Se acaban antes de fin de mes" },
  ],
  presupuestos: [
    { area: "Comercial", repartidoCentavos: 4000000, gastadoCentavos: 4357220, presupuestoCentavos: 6000000, nota: "Al ritmo actual se acaba el día 30", alerta: true },
    { area: "Compras", repartidoCentavos: 12000000, gastadoCentavos: 5570000, presupuestoCentavos: 6200000, nota: "Al ritmo actual se acaba el día 24", alerta: true },
    { area: "Operaciones", repartidoCentavos: 2500000, gastadoCentavos: 1888000, presupuestoCentavos: 3000000, nota: "Va bien · proyección $26,604", alerta: false },
    { area: "Ventas", repartidoCentavos: 3000000, gastadoCentavos: 1770000, presupuestoCentavos: 3000000, nota: "Va bien · proyección $24,941", alerta: false },
    { area: "Marketing", repartidoCentavos: 500000, gastadoCentavos: 387000, presupuestoCentavos: 800000, nota: "Va bien · proyección $5,453", alerta: false },
    { area: "Tecnología", repartidoCentavos: 350000, gastadoCentavos: 227240, presupuestoCentavos: 500000, nota: "Va bien · proyección $3,202", alerta: false },
    { area: "Logística", repartidoCentavos: 3000000, gastadoCentavos: 0, presupuestoCentavos: 2000000, nota: "Va bien · proyección $0", alerta: false },
  ],
  proyeccion: "Proyección con el gasto de los primeros 22 días de octubre.",
});
