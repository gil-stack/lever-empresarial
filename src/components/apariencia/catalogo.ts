/**
 * Catálogo de apariencia de Lever Empresas: escenas de fondo, tonos y temas.
 *
 * Portado del diseño de los socios («Lever Empresas · app y plataforma»,
 * bloque MOTOR-APARIENCIA de la plataforma web). Los valores son los del
 * diseño; las funciones de color son puras para poder probarlas sin navegador.
 */

export const ESCENAS = [
  { clave: "bruma", nombre: "Bruma", descripcion: "Capas de niebla con luz que entra de lado, en calma." },
  {
    clave: "cristal",
    nombre: "Cristal",
    descripcion: "Vidrio estriado con una luz cálida detrás que se mueve despacio.",
  },
  {
    clave: "halo",
    nombre: "Halo",
    descripcion: "El gran círculo de Lever en eclipse; un filo de luz recorre su borde.",
  },
  {
    clave: "calma",
    nombre: "Calma",
    descripcion: "Un degradado limpio con grano fino; nada compite con tus números.",
  },
  {
    clave: "flujo",
    nombre: "Flujo",
    descripcion: "Seda que corre en un solo sentido, como el dinero cuando todo cuadra.",
  },
  {
    clave: "duna",
    nombre: "Duna",
    descripcion: "Dunas vistas desde el aire, con rizos de arena y luz rasante de la tarde.",
  },
] as const;

export type ClaveEscena = (typeof ESCENAS)[number]["clave"];

/** Índice de cada escena dentro del shader (uniforme `uTex`); son los del diseño. */
export const INDICE_SHADER: Readonly<Record<ClaveEscena, number>> = {
  bruma: 29,
  flujo: 32,
  cristal: 38,
  duna: 39,
  halo: 41,
  calma: 42,
};

/** Cinco colores por tono: hondo, base, claro, brillo y metal. */
export type Cinco = readonly [string, string, string, string, string];

export interface Tono {
  readonly nombre: string;
  readonly colores: Cinco;
  /** Color de interfaz del tono; de él sale el acento de los botones. */
  readonly ui: string;
}

export const TONOS = {
  petroleoC: {
    nombre: "Papel Lever",
    colores: ["#140C0A", "#45302A", "#A88478", "#F2E6DC", "#E9DED4"],
    ui: "#FF5A4E",
  },
  grafito: {
    nombre: "Tinta Lever",
    colores: ["#080706", "#2C2624", "#8A7D78", "#EFE9E5", "#D5CDC8"],
    ui: "#FF5A4E",
  },
  cohete: {
    nombre: "Coral Lever",
    colores: ["#64201A", "#C9402F", "#FF6252", "#FFE4DD", "#F6E6E0"],
    ui: "#FF5A4E",
  },
  blanco: {
    nombre: "Papel blanco",
    colores: ["#191817", "#55524F", "#C9C5C0", "#FFFFFF", "#F4F2EF"],
    ui: "#FF5A4E",
  },
  arena: {
    nombre: "Arena",
    colores: ["#120E0A", "#4A3F33", "#B9A68F", "#F4F0E8", "#E8E0D5"],
    ui: "#E9DAC5",
  },
  aluminio: {
    nombre: "Aluminio",
    colores: ["#8F887F", "#BDB5AA", "#DCD5CB", "#FAF7F2", "#EEE9E2"],
    ui: "#FF5A4E",
  },
  mio: {
    nombre: "Tu color",
    colores: ["#0E0A14", "#3B2D66", "#7C6CFF", "#E4DEFF", "#E2DDF2"],
    ui: "#A79CFF",
  },
} as const satisfies Record<string, Tono>;

export type ClaveTono = keyof typeof TONOS;

export const CLAVES_TONO = Object.keys(TONOS) as ClaveTono[];

/** Tema: el «Lever» del diseño se llamaba `cohete` en su código. */
export const TEMAS = [
  { clave: "claro", nombre: "Claro", muestra: ["#ECE6DE", "#FBF8F4", "#141312"] },
  { clave: "oscuro", nombre: "Oscuro", muestra: ["#0E0A08", "#1B1614", "#EEF3EF"] },
  { clave: "lever", nombre: "Lever", muestra: ["#5E1C15", "#FF5A4E", "#FFF5F1"] },
] as const;

export type ClaveTema = (typeof TEMAS)[number]["clave"];

/** Color del desvanecido inferior por tema, en RGB de 0 a 1 (uniforme `uFadeC`). */
export const COLOR_DESVANECIDO: Readonly<Record<ClaveTema, readonly [number, number, number]>> = {
  oscuro: [0.055, 0.04, 0.035],
  claro: [0.925, 0.902, 0.871],
  lever: [0.369, 0.11, 0.082],
};

/** Con el tono de inicio (Papel Lever) algunas escenas llevan su propio color de la marca. */
const TONO_DE_ESCENA: Partial<Record<ClaveEscena, ClaveTono>> = { flujo: "grafito" };

export function esEscena(valor: unknown): valor is ClaveEscena {
  return typeof valor === "string" && ESCENAS.some((escena) => escena.clave === valor);
}

export function esTono(valor: unknown): valor is ClaveTono {
  return typeof valor === "string" && Object.hasOwn(TONOS, valor);
}

export function esTema(valor: unknown): valor is ClaveTema {
  return typeof valor === "string" && TEMAS.some((tema) => tema.clave === valor);
}

export function esColorHex(valor: unknown): valor is string {
  return typeof valor === "string" && /^#[0-9a-fA-F]{6}$/.test(valor);
}

/** `#RRGGBB` → `[r, g, b]` de 0 a 255. */
export function hex2(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Luminancia relativa (WCAG) de un `#RRGGBB`. */
export function lum(hex: string): number {
  const [r, g, b] = hex2(hex).map((v) => {
    const canal = v / 255;
    return canal <= 0.03928 ? canal / 12.92 : Math.pow((canal + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Oscurece un `#RRGGBB` multiplicando cada canal por `1 - k`. */
export function darken(hex: string, k: number): string {
  return "#" + hex2(hex).map((v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0")).join("");
}

/** El tono «Tu color»: una paleta completa a partir de un solo color. */
export function mkPal(hex: string): Tono {
  const c = hex2(hex);
  const mezcla = (destino: number, k: number) =>
    "#" + c.map((v) => Math.round(v + (destino - v) * k).toString(16).padStart(2, "0")).join("");
  return {
    nombre: "Tu color",
    colores: [mezcla(0, 0.9), mezcla(0, 0.58), hex, mezcla(255, 0.84), mezcla(255, 0.78)],
    ui: mezcla(255, 0.18),
  };
}

/** El tono que aplica el tema: Lever siempre es coral; Papel Lever en claro se vuelve Aluminio. */
export function tonoDelTema(tema: ClaveTema, tono: ClaveTono): ClaveTono {
  if (tema === "lever") return "cohete";
  if (tema === "claro" && tono === "petroleoC") return "aluminio";
  return tono;
}

/** El tono con el que se pinta una escena (el del tema, con el color propio de la escena si aplica). */
export function tonoDeEscena(escena: ClaveEscena, tema: ClaveTema, tono: ClaveTono): ClaveTono {
  const delTema = tonoDelTema(tema, tono);
  return delTema === "petroleoC" ? (TONO_DE_ESCENA[escena] ?? delTema) : delTema;
}

/** Los cinco colores de un tono; «Tu color» se arma con `mkPal` si hay color propio válido. */
export function coloresDe(tono: ClaveTono, colorPropio?: string): Tono {
  if (tono === "mio" && esColorHex(colorPropio)) return mkPal(colorPropio);
  return TONOS[tono];
}

export interface Acento {
  /** Acento de botones y elementos activos. */
  readonly acento: string;
  /** El mismo acento como `r,g,b` para usarlo con transparencia. */
  readonly acentoRgb: string;
  /** Color del texto encima del acento. */
  readonly tinta: string;
}

/** Acento por tema, igual que `applyPal` del diseño. */
export function acentoPorTema(tema: ClaveTema, tono: ClaveTono, colorPropio?: string): Acento {
  const paleta = coloresDe(tonoDelTema(tema, tono), colorPropio);
  let acento = paleta.ui;
  if (tema === "claro") {
    // En claro se oscurece hasta que contraste sobre marfil; los pasos acumulan como en el diseño.
    let k = 0;
    while (lum(acento) > 0.18 && k < 0.75) {
      k += 0.05;
      acento = darken(paleta.ui, k);
    }
  } else if (tema === "lever") {
    acento = paleta.colores[3];
  }
  return {
    acento,
    acentoRgb: hex2(acento).join(","),
    tinta: lum(acento) > 0.35 ? "#1A0705" : "#FFFFFF",
  };
}
