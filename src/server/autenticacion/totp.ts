import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP del RFC 6238 con lo que leen Google Authenticator, Microsoft
 * Authenticator y el resto de apps compatibles: HMAC-SHA1, 30 segundos y
 * seis dígitos. La semilla son 20 bytes de azar.
 */

export const PASO_SEGUNDOS = 30;
export const DIGITOS = 6;
const BYTES_SEMILLA = 20;
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function semillaNueva(): Buffer {
  return randomBytes(BYTES_SEMILLA);
}

export function aBase32(bytes: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let salida = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function deBase32(texto: string): Buffer {
  const limpio = texto.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const letra of limpio) {
    const indice = ALFABETO.indexOf(letra);
    if (indice === -1) throw new Error("base32_invalido");
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** La semilla en grupos de cuatro, por si la cámara no lee el QR. */
export function semillaLegible(semilla: Uint8Array): string {
  return aBase32(semilla).match(/.{1,4}/g)?.join(" ") ?? "";
}

export function pasoDe(instante: Date): number {
  return Math.floor(instante.getTime() / 1000 / PASO_SEGUNDOS);
}

export function codigoDelPaso(semilla: Uint8Array, paso: number, digitos = DIGITOS): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const hmac = createHmac("sha1", semilla).update(contador).digest();
  const corte = hmac[hmac.length - 1]! & 0x0f;
  const binario =
    ((hmac[corte]! & 0x7f) << 24) |
    ((hmac[corte + 1]! & 0xff) << 16) |
    ((hmac[corte + 2]! & 0xff) << 8) |
    (hmac[corte + 3]! & 0xff);
  return String(binario % 10 ** digitos).padStart(digitos, "0");
}

export function normalizarCodigoTotp(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  const limpio = entrada.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(limpio) ? limpio : null;
}

/**
 * Acepta el paso actual y uno a cada lado, para un reloj hasta 30 segundos
 * desfasado. El paso que coincide tiene que ser posterior al último ya
 * usado: un código visto por encima del hombro no sirve dos veces.
 */
export function verificarTotp(
  semilla: Uint8Array,
  codigo: string,
  ahora: Date,
  ultimoPaso: number | null,
): number | null {
  const actual = pasoDe(ahora);
  const esperado = Buffer.from(codigo);
  let coincidio: number | null = null;
  for (const paso of [actual - 1, actual, actual + 1]) {
    const candidato = Buffer.from(codigoDelPaso(semilla, paso));
    if (candidato.length === esperado.length && timingSafeEqual(candidato, esperado)) {
      coincidio = coincidio ?? paso;
    }
  }
  if (coincidio === null) return null;
  if (ultimoPaso !== null && coincidio <= ultimoPaso) return null;
  return coincidio;
}

/** La dirección que la app autenticadora lee del QR. */
export function uriOtpauth(emisor: string, cuenta: string, semilla: Uint8Array): string {
  const etiqueta = `${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}`;
  const params = new URLSearchParams({
    secret: aBase32(semilla),
    issuer: emisor,
    algorithm: "SHA1",
    digits: String(DIGITOS),
    period: String(PASO_SEGUNDOS),
  });
  return `otpauth://totp/${etiqueta}?${params.toString()}`;
}
