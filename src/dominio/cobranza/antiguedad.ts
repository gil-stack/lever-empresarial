import { desplazar, diasEntre } from "../flujo/fechas";

/**
 * Antigüedad de saldos y DSO. Las cubetas son las de un reporte de cuentas por
 * cobrar: por vencer, 1–30, 31–60, 61–90 y más de 90 días de atraso.
 *
 * DSO (días de venta en la calle) con el método simple: lo que hoy está por
 * cobrar entre lo emitido en los últimos 90 días, por 90. Sin emitido en la
 * ventana no hay DSO: no se disfraza de cero.
 */

export const CUBETAS = ["por_vencer", "d1_30", "d31_60", "d61_90", "d90_mas"] as const;
export type Cubeta = (typeof CUBETAS)[number];

export const ETIQUETA_CUBETA: Readonly<Record<Cubeta, string>> = {
  por_vencer: "Por vencer",
  d1_30: "1 a 30 días",
  d31_60: "31 a 60 días",
  d61_90: "61 a 90 días",
  d90_mas: "Más de 90 días",
};

export function cubetaDe(vencimiento: string, hoy: string): Cubeta {
  const atraso = diasEntre(vencimiento, hoy);
  if (atraso <= 0) return "por_vencer";
  if (atraso <= 30) return "d1_30";
  if (atraso <= 60) return "d31_60";
  if (atraso <= 90) return "d61_90";
  return "d90_mas";
}

/** Los límites de vencimiento de una cubeta, para filtrar en la base. */
export function rangoDeCubeta(cubeta: Cubeta, hoy: string): { desde: string | null; hasta: string | null } {
  switch (cubeta) {
    case "por_vencer":
      return { desde: hoy, hasta: null };
    case "d1_30":
      return { desde: desplazar(hoy, -30), hasta: desplazar(hoy, -1) };
    case "d31_60":
      return { desde: desplazar(hoy, -60), hasta: desplazar(hoy, -31) };
    case "d61_90":
      return { desde: desplazar(hoy, -90), hasta: desplazar(hoy, -61) };
    case "d90_mas":
      return { desde: null, hasta: desplazar(hoy, -91) };
  }
}

export const VENTANA_DSO = 90;

export function dso(porCobrarCentavos: number, emitidoEnVentanaCentavos: number): number | null {
  if (emitidoEnVentanaCentavos <= 0) return null;
  return Math.round((porCobrarCentavos / emitidoEnVentanaCentavos) * VENTANA_DSO);
}
