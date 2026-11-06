/**
 * La apariencia es personal: cada persona guarda la suya en su navegador y no
 * cambia la de nadie más. Leer o escribir `localStorage` puede fallar (modo
 * privado, almacenamiento bloqueado); entonces se usan los valores del diseño.
 */
import { esColorHex, esEscena, esTema, esTono, type ClaveEscena, type ClaveTema, type ClaveTono } from "./catalogo";

export interface PreferenciasApariencia {
  readonly tema: ClaveTema;
  readonly escena: ClaveEscena;
  readonly tono: ClaveTono;
  /** La luz del fondo sigue al cursor. */
  readonly luzDinamica: boolean;
  /** Fondo animado; apagado queda quieto y gasta menos batería. */
  readonly movimiento: boolean;
  /** Color base del tono «Tu color», en `#RRGGBB`. */
  readonly colorPropio?: string;
}

export const PREFERENCIAS_POR_DEFECTO: PreferenciasApariencia = {
  tema: "oscuro",
  escena: "bruma",
  tono: "petroleoC",
  luzDinamica: true,
  movimiento: true,
};

export type Almacen = Pick<Storage, "getItem" | "setItem">;

const PREFIJO = "lever-apariencia-v1";

/** Clave de la persona; sin persona, la del navegador. */
export function claveDe(persona?: string): string {
  return persona ? `${PREFIJO}:${persona}` : PREFIJO;
}

function almacenDelNavegador(): Almacen | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Lee la apariencia guardada; cada campo inválido o ausente vuelve a su valor por defecto. */
export function leerPreferencias(persona?: string, almacen: Almacen | null = almacenDelNavegador()): PreferenciasApariencia {
  let guardado: Record<string, unknown> = {};
  try {
    const crudo = almacen?.getItem(claveDe(persona));
    const valor: unknown = crudo ? JSON.parse(crudo) : null;
    if (valor && typeof valor === "object" && !Array.isArray(valor)) guardado = valor as Record<string, unknown>;
  } catch {
    // Almacenamiento bloqueado o JSON dañado: se queda con los valores por defecto.
  }
  const base = PREFERENCIAS_POR_DEFECTO;
  return {
    tema: esTema(guardado.tema) ? guardado.tema : base.tema,
    escena: esEscena(guardado.escena) ? guardado.escena : base.escena,
    tono: esTono(guardado.tono) ? guardado.tono : base.tono,
    luzDinamica: typeof guardado.luzDinamica === "boolean" ? guardado.luzDinamica : base.luzDinamica,
    movimiento: typeof guardado.movimiento === "boolean" ? guardado.movimiento : base.movimiento,
    ...(esColorHex(guardado.colorPropio) ? { colorPropio: guardado.colorPropio } : {}),
  };
}

/** Guarda la apariencia. Devuelve `false` si el navegador no dejó guardarla. */
export function guardarPreferencias(
  preferencias: PreferenciasApariencia,
  persona?: string,
  almacen: Almacen | null = almacenDelNavegador(),
): boolean {
  if (!almacen) return false;
  try {
    almacen.setItem(claveDe(persona), JSON.stringify(preferencias));
    return true;
  } catch {
    return false;
  }
}
