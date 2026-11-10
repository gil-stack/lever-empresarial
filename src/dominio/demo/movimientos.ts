import { congelar, type CifraDemo } from "./tipos";

/** Una compra con tarjeta de octubre, tal como la lista el diseño (Gastos y Movimientos). */
export type CompraDemo = {
  readonly dia: number;
  readonly fecha: string;
  readonly hora: string;
  readonly persona: string;
  readonly area: string;
  readonly comercio: string;
  readonly categoria: string;
  readonly lugar: string;
  readonly tarjeta: string;
  readonly centavos: number;
  readonly ivaCentavos: number;
  readonly acreditable: boolean;
  readonly comprobante: string;
  readonly porRevisar: boolean;
};


const P = { cm: ["Carlos Méndez", "Operaciones"], at: ["Ana Torres", "Ventas"], dr: ["Daniela Ruiz", "Compras"], e: ["Eduardo", "Tecnología"], em: ["Eduardo", "Marketing"] } as const;
const T = { comb: "Combustible ••8833", via: "Viáticos ••2291", comp: "Compras ••5170" } as const;

// [día, hora, persona, comercio, categoría, lugar, tarjeta, comprobante, centavos, iva, «por revisar»]
const filas: readonly [number, string, keyof typeof P, string, string, string, string, string, number, number, boolean?][] = [
  [22, "08:41", "cm", "Pemex · Gasolinera 4512", "Combustible", "Querétaro", T.comb, "Correo Lever", 185000, 25517],
  [21, "13:02", "at", "Uber", "Transporte", "Ciudad de México", T.via, "Reenviada", 31250, 4310],
  [21, "10:45", "dr", "Amazon México", "Insumos", "Compra en línea", T.comp, "Reenviada", 251020, 34623],
  [20, "13:00", "cm", "AutoZone", "Materiales", "Querétaro", T.comb, "Factura al pagar", 59200, 8166],
  [20, "12:15", "dr", "Office Depot", "Papelería", "Ciudad de México", T.comp, "Factura al pagar", 642080, 88563],
  [20, "10:02", "e", "Amazon Web Services", "Software", "Compra en línea", "Virtual · AWS ••1182", "Reenviada", 81240, 11206],
  [19, "16:45", "at", "Sanborns", "Comidas", "Ciudad de México", T.via, "Foto del ticket", 68400, 9434, true],
  [19, "11:20", "cm", "Pemex · Gasolinera 0871", "Combustible", "Tepotzotlán", T.comb, "Correo Lever", 210000, 28966],
  [18, "09:30", "em", "Meta Platforms", "Publicidad", "Compra en línea", "Virtual · Meta Ads ••3365", "Reenviada", 387000, 53379],
  [18, "08:15", "cm", "Pemex · Gasolinera 4512", "Combustible", "Querétaro", T.comb, "Correo Lever", 171000, 23586],
  [17, "17:45", "cm", "Caseta Palmillas", "Transporte", "San Juan del Río", T.comb, "Correo Lever", 29600, 4083],
  [16, "17:05", "dr", "Liverpool", "Mobiliario y equipo", "Ciudad de México", T.comp, "Factura al pagar", 589000, 81241],
  [15, "09:10", "cm", "Pemex · Gasolinera 0871", "Combustible", "Tepotzotlán", T.comb, "Correo Lever", 199000, 27448],
  [15, "07:10", "at", "Uber", "Transporte", "Ciudad de México", T.via, "Reenviada", 62450, 8614],
  [14, "15:10", "at", "Restaurante Casa Fuerte", "Comidas", "Tlaquepaque", T.via, "Factura al pagar", 114000, 15724],
  [14, "11:30", "dr", "The Home Depot", "Materiales", "Ciudad de México", T.comp, "Factura al pagar", 996430, 137439],
  [13, "08:50", "at", "Aeroméxico", "Transporte", "Ciudad de México", T.via, "Reenviada", 398000, 54897],
  [13, "07:35", "cm", "Pemex · Gasolinera 4512", "Combustible", "Querétaro", T.comb, "Correo Lever", 186000, 25655],
  [10, "08:40", "cm", "Pemex · Gasolinera 0871", "Combustible", "Tepotzotlán", T.comb, "Correo Lever", 214000, 29517],
  [9, "16:20", "cm", "Caseta Palmillas", "Transporte", "San Juan del Río", T.comb, "Correo Lever", 29600, 4083],
  [9, "12:00", "dr", "Office Depot", "Papelería", "Ciudad de México", T.comp, "Factura al pagar", 348270, 48037],
  [8, "16:40", "dr", "Amazon México", "Insumos", "Compra en línea", T.comp, "Reenviada", 621500, 85724],
  [8, "13:20", "at", "Sanborns", "Comidas", "Ciudad de México", T.via, "Foto del ticket", 72500, 10000],
  [7, "07:50", "cm", "Pemex · Gasolinera 4512", "Combustible", "Querétaro", T.comb, "Correo Lever", 178000, 24552],
  [6, "10:15", "dr", "Costco", "Insumos", "Huixquilucan", T.comp, "Factura al pagar", 873640, 120502],
  [5, "09:00", "e", "Google Workspace", "Software", "Compra en línea", "Virtual · Google Workspace ••7740", "Reenviada", 146000, 20138],
  [5, "08:05", "cm", "Pemex · Gasolinera 0871", "Combustible", "Tepotzotlán", T.comb, "Correo Lever", 205000, 28276],
  [3, "18:10", "cm", "Caseta Palmillas", "Transporte", "San Juan del Río", T.comb, "Correo Lever", 29600, 4083],
  [3, "14:05", "at", "La Nacional", "Comidas", "San Pedro Garza García", T.via, "Factura al pagar", 128600, 17738],
  [3, "08:10", "at", "Starbucks Reserve", "Comidas", "San Pedro Garza García", T.via, "Factura al pagar", 16800, 2317],
  [2, "21:40", "at", "Hotel Safi Royal Valle", "Hospedaje", "San Pedro Garza García", T.via, "Reenviada", 392000, 54069],
  [2, "11:20", "dr", "The Home Depot", "Materiales", "Ciudad de México", T.comp, "Factura al pagar", 1248060, 172146],
  [2, "09:15", "at", "Aeroméxico", "Transporte", "Ciudad de México", T.via, "Reenviada", 486000, 67034],
  [1, "07:30", "cm", "Pemex · Gasolinera 4512", "Combustible", "Querétaro", T.comb, "Correo Lever", 192000, 26483],
];

export const COMPRAS_DE_OCTUBRE: readonly CompraDemo[] = congelar(
  filas.map(([dia, hora, quien, comercio, categoria, lugar, tarjeta, comprobante, centavos, ivaCentavos, porRevisar]) => ({
    dia,
    fecha: `${dia} oct`,
    hora,
    persona: P[quien][0],
    area: P[quien][1],
    comercio,
    categoria,
    lugar,
    tarjeta,
    centavos,
    ivaCentavos,
    acreditable: comprobante !== "Foto del ticket",
    comprobante,
    porRevisar: porRevisar === true,
  })),
);

/** Los lugares donde se usaron las tarjetas, con su dirección, como el panel «Dónde se usó». */
export type LugarDemo = { readonly comercio: string; readonly direccion: string; readonly centavos: number; readonly compras: number; readonly lon: number; readonly lat: number };
export type PuntoDemo = { readonly nombre: string; readonly lon: number; readonly lat: number };

export type MovimientosDemo = {
  /** Las compras del mes que la lista filtra; salen de aquí y no de un import aparte, para pasar por la regla. */
  readonly compras: readonly CompraDemo[];
  readonly cifras: readonly CifraDemo[];
  readonly lugares: readonly LugarDemo[];
  /** Los otros lugares del mes, solo como punto en el mapa. */
  readonly otrosPuntos: readonly PuntoDemo[];
  readonly lugaresResumen: string;
  readonly masLugares: number;
};

export const MOVIMIENTOS_DEMO: MovimientosDemo = congelar({
  compras: COMPRAS_DE_OCTUBRE,
  cifras: [
    { rotulo: "Gastado", valor: "$98,422", nota: "34 compras con los filtros" },
    { rotulo: "Por comprobar", valor: "0", nota: "$0 · IVA en riesgo $0" },
    { rotulo: "IVA acreditable", valor: "$13,381", nota: "De cargos con factura" },
    { rotulo: "Para revisar", valor: "0", nota: "0 sin comprobante · 0 rechazadas" },
  ],
  // Longitud y latitud de cada lugar para el mapa esquemático (sin teselas externas).
  lugares: [
    { comercio: "The Home Depot", direccion: "Periférico Sur 4690, Coyoacán, CDMX", centavos: 2244490, compras: 2, lon: -99.19, lat: 19.3 },
    { comercio: "Office Depot", direccion: "Av. Insurgentes Sur 1235, Benito Juárez, CDMX", centavos: 990350, compras: 2, lon: -99.17, lat: 19.37 },
    { comercio: "Pemex · Gasolinera 4512", direccion: "Av. 5 de Febrero 1203, Querétaro, Qro.", centavos: 912000, compras: 5, lon: -100.39, lat: 20.59 },
    { comercio: "Aeroméxico", direccion: "Aeropuerto Internacional de la Ciudad de México, T2", centavos: 884000, compras: 2, lon: -99.07, lat: 19.43 },
    { comercio: "Costco", direccion: "Blvd. Interlomas 5, Huixquilucan, Méx.", centavos: 873640, compras: 1, lon: -99.27, lat: 19.4 },
    { comercio: "Pemex · Gasolinera 0871", direccion: "Autopista México–Querétaro km 42, Tepotzotlán, Méx.", centavos: 828000, compras: 4, lon: -99.22, lat: 19.72 },
  ],
  otrosPuntos: [
    { nombre: "San Pedro Garza García", lon: -100.4, lat: 25.66 },
    { nombre: "Tlaquepaque", lon: -103.31, lat: 20.64 },
    { nombre: "San Juan del Río", lon: -99.99, lat: 20.39 },
  ],
  lugaresResumen: "15 lugares · 5 compras en línea por $14,868",
  masLugares: 9,
});
