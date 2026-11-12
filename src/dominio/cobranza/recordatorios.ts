import { desplazar, diasEntre } from "../flujo/fechas";

/**
 * Qué correo le toca hoy a un cargo emitido, según el calendario de la
 * empresa. A lo más uno por cargo y por día. El cobro sale al emitirse (si el
 * envío es automático); los recordatorios, solo después del cobro y si el
 * cliente no pidió dejar de recibirlos:
 * - «antes»: `antesDias` antes del vencimiento (0 lo apaga);
 * - «dia»: el día del vencimiento, si está encendido;
 * - «despues»: cada `despuesCadaDias` después del vencimiento, hasta `despuesTope`.
 * Un recordatorio que se pasó de su día no se manda tarde, salvo «después», que
 * manda el último que corresponde.
 */

export type TipoCorreo = "cobro" | "antes" | "dia" | "despues" | "reenvio";

export type Calendario = {
  envioAutomatico: boolean;
  antesDias: number;
  avisoElDia: boolean;
  despuesCadaDias: number;
  despuesTope: number;
};

export type CorreoPrevio = { tipo: TipoCorreo; secuencia: number; dia: string };

export type CargoParaRecordar = {
  estado: string;
  vencimiento: string;
  /** El cliente pidió no recibir recordatorios (o la empresa los apagó). */
  recordatorios: boolean;
};

export const CALENDARIO_POR_OMISION: Calendario = {
  envioAutomatico: true,
  antesDias: 3,
  avisoElDia: true,
  despuesCadaDias: 7,
  despuesTope: 3,
};

export function correoDeHoy(
  cargo: CargoParaRecordar,
  previos: readonly CorreoPrevio[],
  calendario: Calendario,
  hoy: string,
): { tipo: Exclude<TipoCorreo, "reenvio">; secuencia: number } | null {
  if (cargo.estado !== "emitido") return null;
  const hay = (tipo: TipoCorreo, secuencia = 1) => previos.some((p) => p.tipo === tipo && p.secuencia === secuencia);
  const cobroEnviado = hay("cobro") || previos.some((p) => p.tipo === "reenvio");
  if (!cobroEnviado) return calendario.envioAutomatico ? { tipo: "cobro", secuencia: 1 } : null;
  if (previos.some((p) => p.dia === hoy)) return null;
  if (!cargo.recordatorios) return null;
  const v = cargo.vencimiento;
  if (hoy < v) {
    if (calendario.antesDias > 0 && hoy >= desplazar(v, -calendario.antesDias) && !hay("antes")) return { tipo: "antes", secuencia: 1 };
    return null;
  }
  if (hoy === v) return calendario.avisoElDia && !hay("dia") ? { tipo: "dia", secuencia: 1 } : null;
  if (calendario.despuesTope <= 0) return null;
  const k = Math.min(Math.floor(diasEntre(v, hoy) / calendario.despuesCadaDias), calendario.despuesTope);
  if (k >= 1 && !hay("despues", k)) return { tipo: "despues", secuencia: k };
  return null;
}

/** Cómo se lee el calendario en la interfaz y en el pie del correo. */
export function textoCalendario(c: Calendario): string {
  const partes: string[] = [];
  partes.push(c.envioAutomatico ? "el cobro sale solo al emitirse" : "el cobro lo mandas tú");
  if (c.antesDias > 0) partes.push(`recordatorio ${c.antesDias === 1 ? "1 día" : `${c.antesDias} días`} antes`);
  if (c.avisoElDia) partes.push("aviso el día del vencimiento");
  if (c.despuesTope > 0) {
    partes.push(`después, cada ${c.despuesCadaDias === 1 ? "día" : `${c.despuesCadaDias} días`} hasta ${c.despuesTope === 1 ? "1 vez" : `${c.despuesTope} veces`}`);
  }
  const texto = partes.join(", ");
  return texto.charAt(0).toUpperCase() + texto.slice(1) + ".";
}

export const ASUNTO_TIPO: Readonly<Record<TipoCorreo, string>> = {
  cobro: "Cobro",
  antes: "Recordatorio: vence pronto",
  dia: "Vence hoy",
  despues: "Pago vencido",
  reenvio: "Cobro",
};

export const ETIQUETA_TIPO: Readonly<Record<TipoCorreo, string>> = {
  cobro: "Cobro",
  antes: "Recordatorio previo",
  dia: "Aviso del día",
  despues: "Recordatorio de vencido",
  reenvio: "Reenvío",
};
