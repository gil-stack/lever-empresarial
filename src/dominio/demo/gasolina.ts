import { congelar, type CifraDemo } from "./tipos";

export type VehiculoDemo = { readonly nombre: string; readonly detalle: string; readonly litrosMes?: string };
export type CargaDemo = {
  readonly fecha: string;
  readonly hora: string;
  readonly placa: string;
  readonly odometro: string;
  readonly estacion: string;
  readonly lugar: string;
  readonly litros: string;
  readonly centavos: number;
  readonly rendimiento: string;
  /** Vacío = «En orden». */
  readonly alertas: readonly string[];
};

export type GasolinaDemo = {
  readonly cifras: readonly CifraDemo[];
  readonly vehiculos: readonly VehiculoDemo[];
  readonly limites: readonly { readonly rotulo: string; readonly valor: string }[];
  readonly combustibles: readonly { readonly nombre: string; readonly permitido: boolean }[];
  readonly estaciones: readonly { readonly nombre: string; readonly permitido: boolean }[];
  readonly reglas: readonly { readonly titulo: string; readonly detalle?: string; readonly activa: boolean }[];
  readonly cargas: readonly CargaDemo[];
  readonly alertasDelMes: string;
};

type Tupla = [fecha: string, hora: string, odometro: string, gasolinera: "4512" | "0871", litros: string, centavos: number, rendimiento: string, alertas?: string[]];

const tanque = (l: string) => `Cargó ${l} L, más que el tanque (80 L)`;
const bajo = "Rendimiento bajo: 6 km/l (normal 9.6)";
const CARGAS: Tupla[] = [
  ["22 oct", "08:41", "60,848", "4512", "75.85", 185000, "9.9"],
  ["19 oct", "11:20", "60,097", "0871", "86.10", 210000, "6", [tanque("86.1"), bajo]],
  ["18 oct", "08:15", "59,580", "4512", "70.11", 171000, "9.3"],
  ["15 oct", "09:10", "58,928", "0871", "81.59", 199000, "9.8", [tanque("81.6")]],
  ["13 oct", "07:35", "58,128", "4512", "76.26", 186000, "9.5"],
  ["10 oct", "08:40", "57,404", "0871", "87.74", 214000, "9.9", [tanque("87.7")]],
  ["7 oct", "07:50", "56,535", "4512", "72.98", 178000, "9.6"],
  ["5 oct", "08:05", "55,834", "0871", "84.05", 205000, "6", [tanque("84.0"), bajo]],
  ["1 oct", "07:30", "55,330", "4512", "78.72", 192000, "9.8"],
  ["29 sep", "08:55", "54,559", "4512", "70.52", 172000, "9.5"],
  ["27 sep", "09:05", "53,889", "0871", "84.46", 206000, "9.9", [tanque("84.5")]],
  ["25 sep", "07:45", "53,053", "4512", "79.54", 194000, "9.6"],
  ["24 sep", "11:05", "52,289", "0871", "81.18", 198000, "9.3", [tanque("81.2")]],
  ["22 sep", "08:10", "51,534", "0871", "77.08", 188000, "6", [bajo]],
  ["16 sep", "07:48", "51,072", "4512", "67.24", 164000, "9.5"],
  ["11 sep", "07:55", "50,433", "4512", "73.39", 179000, "9.9"],
  ["9 sep", "08:20", "49,706", "0871", "82.41", 201000, "9.6", [tanque("82.4")]],
  ["2 sep", "07:40", "48,915", "4512", "75.85", 185000, "9.3"],
];

export const GASOLINA_DEMO: GasolinaDemo = congelar({
  cifras: [
    { rotulo: "Litros en octubre", valor: "713 L", nota: "$17,400 en 9 cargas" },
    { rotulo: "Rendimiento promedio", valor: "8.8 km/l", nota: "6,289 km recorridos" },
    { rotulo: "Alertas", valor: "4", nota: "Cargas para revisar este mes", tono: "aviso" },
    { rotulo: "Facturas de gasolina", valor: "9/9", nota: "Pagar con tarjeta la hace deducible" },
  ],
  vehiculos: [
    { nombre: "Nissan NP300 2023 · NLA-48-21", detalle: "Carlos Méndez · tanque 80 L · Magna · Combustible ••8833 · odómetro 60,848 km", litrosMes: "713 L este mes" },
    { nombre: "Renault Kangoo 2022 · PXN-71-08", detalle: "Jorge Salas · tanque 50 L · Magna" },
  ],
  limites: [
    { rotulo: "Litros por carga", valor: "80" },
    { rotulo: "Por día", valor: "120" },
    { rotulo: "Por mes", valor: "600" },
  ],
  combustibles: [
    { nombre: "Magna", permitido: true },
    { nombre: "Premium", permitido: false },
    { nombre: "Diésel", permitido: false },
  ],
  estaciones: [
    { nombre: "Pemex", permitido: true },
    { nombre: "BP", permitido: true },
    { nombre: "Shell", permitido: true },
    { nombre: "G500", permitido: true },
    { nombre: "Oxxo Gas", permitido: false },
    { nombre: "Mobil", permitido: false },
  ],
  reglas: [
    { titulo: "Bloquear cargas de 11 pm a 5 am", activa: true },
    { titulo: "Bloquear cargas en fin de semana", activa: false },
    { titulo: "Pedir el odómetro en cada carga", detalle: "La app lo pide al pagar; con eso se calcula el rendimiento", activa: true },
  ],
  cargas: CARGAS.map(([fecha, hora, odometro, gasolinera, litros, centavos, rendimiento, alertas]) => ({
    fecha,
    hora,
    placa: "NLA-48-21",
    odometro: `Carlos Méndez · ${odometro} km`,
    estacion: `Pemex · Gasolinera ${gasolinera}`,
    lugar: gasolinera === "4512" ? "Querétaro" : "Tepotzotlán",
    litros,
    centavos,
    rendimiento,
    alertas: alertas ?? [],
  })),
  alertasDelMes: "4 alertas de abuso este mes",
});
