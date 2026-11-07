import { congelar, type AccionDemo, type CifraDemo, type EstadoDemo } from "./tipos";

export type UsoDeLineaDemo = { readonly titulo: string; readonly detalle: string; readonly porDefinir?: boolean; readonly accion: AccionDemo };
export type PagoProgramadoDemo = { readonly fecha: string; readonly concepto: string; readonly capitalCentavos: number; readonly interesesCentavos: number; readonly totalCentavos: number; readonly estado: EstadoDemo };

export type CreditoDemo = {
  readonly cifras: readonly CifraDemo[];
  readonly usos: readonly UsoDeLineaDemo[];
  readonly simulador: {
    readonly montoCentavos: number;
    readonly plazos: readonly string[];
    readonly elegido: number;
    readonly mensualCentavos: number;
    readonly totalCentavos: number;
    readonly comisionCentavos: number;
    readonly cat: string;
  };
  readonly pagos: readonly PagoProgramadoDemo[];
  readonly otorgante: string;
  readonly usado: string;
  readonly pagarNota: string;
};

export const CREDITO_DEMO: CreditoDemo = congelar({
  cifras: [
    { rotulo: "Disponible", valor: "$1,080,000", nota: "Línea revolvente empresarial", avance: 0.28 },
    { rotulo: "Dispuesto", valor: "$420,000", nota: "de $1,500,000 autorizados" },
    { rotulo: "Próximo pago", valor: "$39,715", nota: "5 de noviembre · se cobra de la cuenta" },
    { rotulo: "Tasa y CAT", valor: "24.0%", nota: "Fija anual sin IVA · CAT PROMEDIO 30.6% Sin IVA · para fines informativos y de comparación" },
  ],
  usos: [
    { titulo: "Disponer a la cuenta", detalle: "El dinero llega a la cuenta de la empresa y de ahí lo asignas a tarjetas.", accion: { etiqueta: "Disponer", tipo: "principal" } },
    { titulo: "Ampliar la línea", detalle: "Tu SOFIPO revisa tu historial y tus estados de cuenta. Respuesta en 48 horas hábiles.", accion: { etiqueta: "Solicitar", tipo: "secundaria" } },
    { titulo: "Contrato y tabla de amortización", detalle: "Contrato de apertura de crédito en cuenta corriente · registro RECA", porDefinir: true, accion: { etiqueta: "Descargar", tipo: "fantasma" } },
  ],
  simulador: {
    montoCentavos: 50000000,
    plazos: ["6 meses", "12 meses", "18 meses", "24 meses"],
    elegido: 1,
    mensualCentavos: 4727980,
    totalCentavos: 56735758,
    comisionCentavos: 750000,
    cat: "30.6% Sin IVA",
  },
  pagos: [
    { fecha: "15 oct 2026", concepto: "Mensualidad de octubre", capitalCentavos: 3005000, interesesCentavos: 840000, totalCentavos: 3845000, estado: { texto: "Pagado", tono: "acento" } },
    { fecha: "5 nov 2026", concepto: "Mensualidad de noviembre", capitalCentavos: 3131503, interesesCentavos: 840000, totalCentavos: 3971503, estado: { texto: "Programado", tono: "aviso" } },
    { fecha: "5 dic 2026", concepto: "Mensualidad de diciembre", capitalCentavos: 3194133, interesesCentavos: 777370, totalCentavos: 3971503, estado: { texto: "Próximo", tono: "tenue" } },
  ],
  otorgante: "Crédito otorgado por tu SOFIPO",
  usado: "Usado $420,000.00 de $1,500,000.00",
  pagarNota: "Abona cuando quieras: lo que pagas vuelve a estar disponible y el pago se concilia solo.",
});
