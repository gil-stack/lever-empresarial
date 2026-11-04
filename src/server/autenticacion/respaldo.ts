import { createHash, randomInt } from "node:crypto";

/**
 * Diez códigos de dieciséis caracteres. Son 80 bits de azar, así que un
 * SHA-256 basta para guardarlos, igual que el token de la sesión.
 * El alfabeto no trae 0, 1, I ni O para que no se confundan al teclear.
 */

export const CANTIDAD_RESPALDO = 10;
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LARGO = 16;

export function codigosNuevos(cantidad = CANTIDAD_RESPALDO): string[] {
  const codigos = new Set<string>();
  while (codigos.size < cantidad) {
    let crudo = "";
    for (let i = 0; i < LARGO; i += 1) crudo += ALFABETO[randomInt(ALFABETO.length)];
    codigos.add(crudo.match(/.{4}/g)!.join("-"));
  }
  return [...codigos];
}

export function normalizarRespaldo(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  const limpio = entrada.replace(/[\s-]/g, "").toUpperCase();
  if (limpio.length !== LARGO) return null;
  for (const letra of limpio) if (!ALFABETO.includes(letra)) return null;
  return limpio;
}

export function hashDeRespaldo(normalizado: string): string {
  return createHash("sha256").update(`respaldo:${normalizado}`).digest("hex");
}
