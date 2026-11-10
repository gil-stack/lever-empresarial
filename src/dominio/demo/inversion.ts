import { congelar, type CifraDemo, type RangoDemo } from "./tipos";

export type PlazoDemo = { readonly dias: string; readonly tasa: string };
export type InversionVivaDemo = { readonly titulo: string; readonly vence: string; readonly rendimiento: string };

export type InversionDemo = {
  readonly cifras: readonly CifraDemo[];
  readonly plazos: readonly PlazoDemo[];
  readonly elegido: number;
  readonly montoCentavos: number;
  /** El rango del deslizador del diseño (#ivR: de 10,000 a lo disponible en la cuenta). */
  readonly rango: RangoDemo;
  readonly recibes: string;
  readonly recibesCentavos: number;
  readonly rendimientoCentavos: number;
  readonly gat: string;
  readonly reinvertir: { readonly titulo: string; readonly detalle: string; readonly activo: boolean };
  readonly invertir: string;
  readonly vivas: readonly InversionVivaDemo[];
  readonly nota: string;
};

export const INVERSION_DEMO: InversionDemo = congelar({
  cifras: [
    { rotulo: "Invertido a plazo fijo", valor: "$750,000", nota: "2 inversiones en tu SOFIPO" },
    { rotulo: "Rendimiento al vencimiento", valor: "+$14,739", nota: "Antes de impuestos" },
    { rotulo: "Próximo vencimiento", valor: "12 nov 2026", nota: "$250,000 · se reinvierte solo" },
    { rotulo: "Disponible en la cuenta", valor: "$1,284,560", nota: "Para invertir o pagar hoy" },
  ],
  plazos: [
    { dias: "28 días", tasa: "9.50% anual" },
    { dias: "91 días", tasa: "10.20% anual" },
    { dias: "182 días", tasa: "10.80% anual" },
    { dias: "364 días", tasa: "11.40% anual" },
  ],
  elegido: 1,
  montoCentavos: 30000000,
  rango: { minimoCentavos: 1000000, maximoCentavos: 128456040, pasoCentavos: 1000000 },
  recibes: "Recibes el 21 ene 2027",
  recibesCentavos: 30773500,
  rendimientoCentavos: 773500,
  gat: "10.60% · 6.34%",
  reinvertir: { titulo: "Reinvertir al vencer", detalle: "Capital y rendimiento vuelven a invertirse al mismo plazo.", activo: true },
  invertir: "Invertir $300,000 a 91 días",
  vivas: [
    { titulo: "$500,000 a 91 días · 10.20%", vence: "Vence el 15 dic 2026 · se reinvierte solo", rendimiento: "+$12,892" },
    { titulo: "$250,000 a 28 días · 9.50%", vence: "Vence el 12 nov 2026 · se reinvierte solo", rendimiento: "+$1,847" },
  ],
  nota: "Producto ofrecido y operado por tu SOFIPO. Tasas y GAT ilustrativos, calculados el 22 oct 2026 para fines de comparación, antes de impuestos; el GAT real descuenta una inflación estimada de 4% anual. Tus depósitos están protegidos por el Fondo de Protección de Sociedades Financieras Populares hasta por 25,000 UDIS por persona.",
});
