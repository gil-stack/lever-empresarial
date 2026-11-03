/**
 * La suscripción vacía no es cero. Cero es otra decisión: persona, tarjeta
 * e implementación. El campo vacío se dice con una frase, no con un monto.
 */

export const DIAS_DE_RECORRIDO = 30;
export const CIFRA_NO_PUBLICADA = "cifra no publicada";
export const FRASE_SIN_CONSULTA = "No se pudo consultar el precio.";

const AGRUPADO = /^\$?\d{1,3}(?:,\d{3}){1,3}(?:\.\d{1,2})?$/;
const SIMPLE = /^\$?\d{1,12}(?:\.\d{1,2})?$/;
const ZONA = "America/Mexico_City";

const fechaLarga = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: ZONA,
});

const fechaYHoraFormato = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: ZONA,
});

export type ResultadoMonto =
  | { ok: true; centavos: bigint }
  | { ok: false; codigo: "monto_invalido" | "monto_en_cero" };

export type TarifaVisible = {
  disponible: boolean;
  suscripcion: string;
  suscripcionPublicada: boolean;
  publicadaEl: string | null;
  spei: string;
  porPersona: string;
  porTarjeta: string;
  implementacion: string;
};

export type LecturaSuscripcion =
  | { tipo: "sin_empresa" }
  | { tipo: "ausente" }
  | { tipo: "no_disponible" }
  | {
      tipo: "lista";
      estado: "recorrido" | "aceptada";
      titulo: string;
      relato: string;
    };

const CERO = BigInt(0);
const CIEN = BigInt(100);

export function formatoPesos(centavos: bigint): string {
  if (centavos < CERO) {
    throw new Error("monto_negativo");
  }
  const pesos = centavos / CIEN;
  const resto = centavos % CIEN;
  const conComas = pesos.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${conComas}.${resto.toString().padStart(2, "0")}`;
}

export function presentarSuscripcion(centavos: bigint | null): string {
  if (centavos === null) return CIFRA_NO_PUBLICADA;
  return formatoPesos(centavos);
}

export function centavosDesdePesos(texto: string): ResultadoMonto {
  if (texto.length > 32) return { ok: false, codigo: "monto_invalido" };
  const recortado = texto.trim();
  if (!AGRUPADO.test(recortado) && !SIMPLE.test(recortado)) {
    return { ok: false, codigo: "monto_invalido" };
  }
  const sinMoneda = recortado.replace("$", "").replaceAll(",", "");
  const [enteros, fraccion = ""] = sinMoneda.split(".");
  if (enteros.length > 12) return { ok: false, codigo: "monto_invalido" };
  const centavos = BigInt(enteros) * CIEN + BigInt(fraccion.padEnd(2, "0"));
  if (centavos <= CERO) return { ok: false, codigo: "monto_en_cero" };
  return { ok: true, centavos };
}

export function finDeRecorrido(inicio: Date): Date {
  return new Date(inicio.getTime() + DIAS_DE_RECORRIDO * 24 * 60 * 60 * 1000);
}

export function fechaEnMexico(instante: Date): string {
  return fechaLarga.format(instante);
}

export function fechaYHoraEnMexico(instante: Date): string {
  return fechaYHoraFormato.format(instante);
}

export function relatoRecorrido(inicio: Date, ahora: Date): { vigente: boolean; texto: string } {
  const fin = finDeRecorrido(inicio);
  const desde = fechaYHoraEnMexico(inicio);
  const hasta = fechaYHoraEnMexico(fin);
  if (ahora.getTime() < fin.getTime()) {
    return {
      vigente: true,
      texto: `Recorrido de ${DIAS_DE_RECORRIDO} días, desde el ${desde} hasta el ${hasta}.`,
    };
  }
  return {
    vigente: false,
    texto: `El recorrido de ${DIAS_DE_RECORRIDO} días terminó el ${hasta}. La suscripción sigue en recorrido.`,
  };
}

export function relatoAceptada(cuando: Date, nombre: string | null): string {
  const fecha = fechaYHoraEnMexico(cuando);
  const limpio = nombre?.trim() ?? "";
  if (limpio.length > 0) {
    return `Aceptada el ${fecha}. La registró ${limpio}.`;
  }
  return `Aceptada el ${fecha}.`;
}

export function notaDeLosTreintaDias(): string {
  return `El recorrido de la interfaz dura ${DIAS_DE_RECORRIDO} días desde el alta de la empresa. No es un plan en cero.`;
}

export function existePasoPublicar(entrada: {
  esOperador: boolean;
  montoPublicado: boolean;
  disponible: boolean;
}): boolean {
  return entrada.esOperador && entrada.disponible && !entrada.montoPublicado;
}

export function existePasoAceptada(entrada: {
  esOperador: boolean;
  montoPublicado: boolean;
  estado: "recorrido" | "aceptada" | null;
}): boolean {
  return entrada.esOperador && entrada.montoPublicado && entrada.estado === "recorrido";
}

export function cerosDeProducto(): { porPersona: string; porTarjeta: string; implementacion: string } {
  const cero = formatoPesos(CERO);
  return { porPersona: cero, porTarjeta: cero, implementacion: cero };
}
