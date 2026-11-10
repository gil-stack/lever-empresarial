import { formatoPesos } from "../../../dominio/centavos";
import { clabeVisible } from "../../../dominio/clabe";
import { fechaConAnio } from "../../../dominio/flujo/fechas";
import type { CorreoPlantilla } from "../tipos";
import { armarCorreo } from "./marco";

export type TipoCorreoCobro = "cobro" | "antes" | "dia" | "despues" | "reenvio";

export type DatosCobro = {
  tipo: TipoCorreoCobro;
  /** La empresa que cobra. */
  razonSocial: string;
  cliente: string;
  concepto: string;
  /** «noviembre 2026» o «nov – dic 2026». */
  periodo: string;
  montoCentavos: number;
  /** Lo que falta por pagar (el monto menos lo ya recibido). */
  saldoCentavos: number;
  vencimiento: string;
  clabe: string;
  banco: string | null;
  beneficiario: string;
  referencia: string;
  /** La página del pagador con el token de este correo. */
  enlace: string;
  /** El correo de la empresa: también va como «Responder a». */
  contacto: string | null;
};

const TITULO: Record<TipoCorreoCobro, (d: DatosCobro) => string> = {
  cobro: (d) => `${d.razonSocial} te envía su cobro de ${d.periodo}`,
  reenvio: (d) => `${d.razonSocial} te envía su cobro de ${d.periodo}`,
  antes: (d) => `Tu pago a ${d.razonSocial} vence el ${fechaConAnio(d.vencimiento)}`,
  dia: (d) => `Tu pago a ${d.razonSocial} vence hoy`,
  despues: (d) => `Tu pago a ${d.razonSocial} está vencido`,
};

const ASUNTO: Record<TipoCorreoCobro, string> = {
  cobro: "Cobro",
  reenvio: "Cobro",
  antes: "Recordatorio",
  dia: "Vence hoy",
  despues: "Pago vencido",
};

/**
 * El correo que recibe el cliente de la empresa. Dice quién cobra, cuánto, por
 * qué periodo, cuándo vence y a dónde pagar: la CLABE completa con su banco y su
 * beneficiario, y la referencia que debe escribir en su transferencia. Todo valor
 * pasa por el escapado del marco; el asunto no lleva saltos de línea.
 *
 * Lever no recibe este dinero: va a la cuenta de la empresa. El pie lo dice y
 * da el contacto de la empresa; las respuestas van a ese contacto, no a Lever.
 */
export function plantillaCobro(d: DatosCobro): CorreoPlantilla {
  const parcial = d.saldoCentavos < d.montoCentavos;
  const parrafos = [
    `Hola, ${d.cliente}. ${d.tipo === "despues" ? `El pago de «${d.concepto}» venció el ${fechaConAnio(d.vencimiento)} y todavía no lo vemos.` : `Este es el cobro de «${d.concepto}».`}`,
    parcial
      ? `Ya recibimos ${formatoPesos(d.montoCentavos - d.saldoCentavos)}; faltan ${formatoPesos(d.saldoCentavos)}.`
      : `Paga ${formatoPesos(d.saldoCentavos)} por transferencia SPEI a la CLABE de abajo y escribe la referencia ${d.referencia} en el campo «Referencia» de tu banca. Así se identifica tu pago sin que tengas que avisar.`,
    ...(d.tipo === "despues" ? ["Si ya pagaste, ignora este correo: el pago puede tardar en reflejarse."] : []),
  ];
  return armarCorreo(`${ASUNTO[d.tipo]} · ${d.razonSocial} · ${formatoPesos(d.saldoCentavos)} · vence ${fechaConAnio(d.vencimiento)}`, {
    preencabezado: `${formatoPesos(d.saldoCentavos)} a la CLABE de ${d.beneficiario}, referencia ${d.referencia}.`,
    kicker: `Cobro de ${d.razonSocial}`,
    titulo: TITULO[d.tipo](d),
    parrafos,
    datos: [
      ["Concepto", d.concepto],
      ["Periodo", d.periodo],
      [parcial ? "Falta por pagar" : "Monto", formatoPesos(d.saldoCentavos)],
      ["Vence", fechaConAnio(d.vencimiento)],
      ["CLABE", clabeVisible(d.clabe)],
      ...(d.banco ? ([["Banco", d.banco]] as const) : []),
      ["Beneficiario", d.beneficiario],
      ["Referencia", d.referencia],
    ],
    boton: { texto: "Ver los datos para pagar", url: d.enlace },
    notas: [
      `Antes de pagar, revisa que el beneficiario sea ${d.beneficiario}. Lever envía este correo por encargo de ${d.razonSocial} y no recibe este dinero: va directo a esa cuenta.`,
      d.contacto
        ? `¿Dudas sobre este cobro? Responde a este correo o escribe a ${d.contacto}.`
        : `¿Dudas sobre este cobro? Comunícate directamente con ${d.razonSocial}.`,
      ...(d.tipo === "cobro" || d.tipo === "reenvio" ? [] : ["¿No quieres recibir recordatorios? Pídelo desde el botón de arriba; le avisamos a la empresa."]),
    ],
    pie: `LEVER · Cobranza de ${d.razonSocial}. Las respuestas a este correo le llegan a ${d.razonSocial}.`,
  });
}

/** Aviso interno: la CLABE donde la empresa recibe sus cobros cambió. Solo las terminaciones. */
export function plantillaAvisoClabeCobranza(d: { razonSocial: string; persona: string; anterior: string | null; nueva: string; enlace: string }): CorreoPlantilla {
  return armarCorreo(`Cambió la CLABE de cobranza · ${d.razonSocial}`, {
    preencabezado: `La CLABE donde tus clientes te pagan ahora termina en ${d.nueva}.`,
    kicker: "Aviso de seguridad",
    titulo: `Cambió la CLABE donde ${d.razonSocial} recibe sus cobros`,
    parrafos: [
      `${d.persona} ${d.anterior ? `cambió la CLABE de cobranza de la terminación ${d.anterior} a la ${d.nueva}` : `registró la CLABE de cobranza con terminación ${d.nueva}`}. Los correos de cobro nuevos llevan esa cuenta.`,
      "Si no reconoces este cambio, revísalo de inmediato: un cambio de CLABE es la forma más común de desviar pagos de clientes.",
    ],
    boton: { texto: "Revisar la configuración de cobranza", url: d.enlace },
    notas: ["Recibes este aviso porque administras o llevas las finanzas de la empresa en Lever."],
  });
}

/** Aviso interno: un cliente pidió no recibir recordatorios desde su enlace. */
export function plantillaAvisoSinRecordatorios(d: { razonSocial: string; cliente: string; enlace: string }): CorreoPlantilla {
  return armarCorreo(`${d.cliente} pidió no recibir recordatorios · ${d.razonSocial}`, {
    preencabezado: `${d.cliente} ya no recibirá recordatorios de pago. Los cobros nuevos sí le llegan.`,
    kicker: "Cobranza",
    titulo: `${d.cliente} pidió no recibir recordatorios`,
    parrafos: [
      `Desde el enlace de su cobro, ${d.cliente} pidió dejar de recibir recordatorios de pago de ${d.razonSocial}. Los cobros nuevos le siguen llegando; los recordatorios antes, el día y después del vencimiento, ya no.`,
      "Puedes volver a encenderlos desde la ficha del cliente si lo acuerdan.",
    ],
    boton: { texto: "Ver la ficha del cliente", url: d.enlace },
    notas: ["Lever avisa a la empresa cada vez que un cliente cambia cómo quiere recibir sus cobros."],
  });
}
