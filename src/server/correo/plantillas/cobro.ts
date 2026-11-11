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

/**
 * Aviso interno: cambió el beneficiario o el correo de contacto de la cobranza
 * (r63-N3). El contacto es el Reply-To de cada cobro: quien lo cambia recibe
 * las respuestas de los clientes, como «¿a qué cuenta pago?».
 */
export function plantillaAvisoDatosCobranza(d: {
  razonSocial: string;
  persona: string;
  beneficiario: { anterior: string | null; nuevo: string } | null;
  contacto: { anterior: string | null; nuevo: string | null } | null;
  enlace: string;
}): CorreoPlantilla {
  const que = d.beneficiario && d.contacto ? "el beneficiario y el correo de contacto" : d.beneficiario ? "el beneficiario" : "el correo de contacto";
  const parrafos: string[] = [];
  if (d.beneficiario) {
    parrafos.push(`${d.persona} cambió el beneficiario de los cobros${d.beneficiario.anterior ? ` de «${d.beneficiario.anterior}»` : ""} a «${d.beneficiario.nuevo}». Es el nombre que tus clientes ven para revisar a quién le pagan.`);
  }
  if (d.contacto) {
    parrafos.push(d.contacto.nuevo
      ? `${d.persona} cambió el correo de contacto de cobranza${d.contacto.anterior ? ` de ${d.contacto.anterior}` : ""} a ${d.contacto.nuevo}. Ahí llegan las respuestas de tus clientes a cada cobro.`
      : `${d.persona} quitó el correo de contacto de cobranza${d.contacto.anterior ? ` (${d.contacto.anterior})` : ""}. Las respuestas de tus clientes ya no le llegan a nadie.`);
  }
  parrafos.push("Si no reconoces este cambio, revísalo de inmediato: desviar las respuestas de los clientes o cambiar el beneficiario son formas de desviar pagos.");
  return armarCorreo(`Cambió ${que} de cobranza · ${d.razonSocial}`, {
    preencabezado: `Cambió ${que} de la cobranza de ${d.razonSocial}.`,
    kicker: "Aviso de seguridad",
    titulo: `Cambió ${que} de la cobranza de ${d.razonSocial}`,
    parrafos,
    boton: { texto: "Revisar la configuración de cobranza", url: d.enlace },
    notas: ["Recibes este aviso porque administras o llevas las finanzas de la empresa en Lever."],
  });
}

/** Aviso interno: Fintoc avisó que la empresa devolvió al ordenante un abono ya aplicado (r63-N8). */
export function plantillaAvisoDevolucionCobranza(d: { razonSocial: string; cliente: string | null; monto: string; enlace: string }): CorreoPlantilla {
  const quien = d.cliente ?? "un cliente sin identificar";
  return armarCorreo(`Se devolvió un abono de ${quien} · ${d.razonSocial}`, {
    preencabezado: `El abono de ${d.monto} se devolvió al ordenante y su cargo volvió a quedar pendiente.`,
    kicker: "Cobranza",
    titulo: `Se devolvió un abono de ${d.monto}`,
    parrafos: [
      `Fintoc avisó que ${d.razonSocial} devolvió al ordenante el abono de ${d.monto} de ${quien}. Lever revirtió lo que ese abono había pagado: el cargo volvió a quedar pendiente y vuelve a recibir recordatorios.`,
      "Si esa devolución no la pidió nadie de tu empresa, revísala con Fintoc.",
    ],
    boton: { texto: "Ver la cobranza", url: d.enlace },
    notas: ["Recibes este aviso porque administras o llevas las finanzas de la empresa en Lever."],
  });
}

/**
 * Aviso interno (decisión de Gil, 2026-11-11): un aviso de Fintoc retenido mientras la empresa estuvo suspendida no se
 * pudo registrar solo (quedó «fallido»). El dinero ya está en su cuenta; lo registran a mano. Sin datos del ordenante
 * ni el código del error, que se quedan en la bitácora.
 */
export function plantillaAvisoRetenidoFallidoCobranza(d: {
  razonSocial: string; devolucion: boolean; monto: string; fecha: string; referencia: string | null; enlace: string;
}): CorreoPlantilla {
  const conReferencia = d.referencia ? ` con la referencia ${d.referencia}` : "";
  const notas = ["Recibes este aviso porque administras o llevas las finanzas de la empresa en Lever."];
  if (d.devolucion) {
    return armarCorreo(`Una devolución de ${d.monto} no se registró sola · ${d.razonSocial}`, {
      preencabezado: `Fintoc avisó una devolución de ${d.monto} que Lever no pudo registrar sola en la cobranza.`,
      kicker: "Cobranza",
      titulo: `Una devolución de ${d.monto} no se registró sola`,
      parrafos: [
        `El ${d.fecha}, Fintoc avisó que ${d.razonSocial} devolvió al ordenante un abono de ${d.monto}${conReferencia}. Lever lo guardó mientras la empresa estuvo suspendida y después no pudo registrarlo solo en la cobranza.`,
        "Revisa ese pago en la cobranza: si sigue aplicado a un cargo, reviértelo para que el cargo vuelva a quedar pendiente.",
      ],
      boton: { texto: "Ir a la cobranza", url: d.enlace },
      notas,
    });
  }
  return armarCorreo(`Un depósito de ${d.monto} no se registró solo · ${d.razonSocial}`, {
    preencabezado: `El dinero sí llegó a tu cuenta. Regístralo a mano para que se detengan los recordatorios.`,
    kicker: "Cobranza",
    titulo: `Llegó un depósito de ${d.monto} que no se registró solo`,
    parrafos: [
      `El ${d.fecha} llegó a la cuenta de cobranza de ${d.razonSocial} un depósito de ${d.monto}${conReferencia}. El dinero sí está en tu cuenta, pero Lever no pudo registrarlo solo en la cobranza: lo guardó mientras la empresa estuvo suspendida y después no pudo aplicarlo.`,
      "Regístralo a mano en el cargo que corresponde («Registrar pago») para que Lever deje de mandarle recordatorios a tu cliente. Si ya lo registraste, no hace falta nada más.",
    ],
    boton: { texto: "Ir a la cobranza", url: d.enlace },
    notas,
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
