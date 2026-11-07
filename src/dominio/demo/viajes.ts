import { congelar } from "./tipos";

export type GrupoDemo = {
  readonly nombre: string;
  readonly tipo: string;
  readonly fechas: string;
  readonly estado: string;
  readonly gastadoCentavos: number;
  readonly presupuestoCentavos: number;
  readonly iniciales: readonly string[];
  readonly detalle: string;
  readonly solicitudes: number;
  readonly icono: "personas" | "avion";
};

export type ViajesDemo = { readonly intro: string; readonly grupos: readonly GrupoDemo[]; readonly resumen: string };

export const VIAJES_DEMO: ViajesDemo = congelar({
  intro: "Para una salida o actividad ocasional: un viaje de negocios, un evento o un proyecto. Eliges a las personas, las fechas, el presupuesto y un tope por día. Pagan con sus mismas tarjetas; si una compra rebasa el tope, se rechaza y la persona puede solicitar aprobación o cancelar.",
  grupos: [
    { nombre: "Cierre con Grupo Norte", tipo: "Evento", fechas: "22 oct al 23 oct", estado: "En curso", gastadoCentavos: 0, presupuestoCentavos: 1000000, iniciales: ["E", "AT"], detalle: "2 personas · tope $4,000 al día · a cargo de Eduardo", solicitudes: 1, icono: "personas" },
    { nombre: "Expo Monterrey", tipo: "Viaje de negocios · Monterrey", fechas: "19 oct al 24 oct", estado: "En curso", gastadoCentavos: 395000, presupuestoCentavos: 1500000, iniciales: ["CM"], detalle: "1 persona · tope $2,500 al día · a cargo de Carlos Méndez", solicitudes: 0, icono: "avion" },
  ],
  resumen: "2 grupos activos · presupuesto $25,000 · gastado $3,950",
});
