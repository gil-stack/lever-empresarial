import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * La semilla TOTP se cifra con AES-256-GCM. La llave vive en el servidor,
 * no en la base: una copia de la base sola no genera códigos. El id de la
 * persona va como dato asociado, así una semilla copiada a otra fila no
 * descifra.
 */

const VERSION = "v1";

export function cifrarSemilla(semilla: Uint8Array, userId: string, llave: Buffer): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", llave, iv);
  cifrador.setAAD(Buffer.from(userId));
  const cuerpo = Buffer.concat([cifrador.update(semilla), cifrador.final()]);
  const etiqueta = cifrador.getAuthTag();
  return [VERSION, iv.toString("base64url"), cuerpo.toString("base64url"), etiqueta.toString("base64url")].join(".");
}

export function descifrarSemilla(cifrado: string, userId: string, llave: Buffer): Buffer {
  const partes = cifrado.split(".");
  if (partes.length !== 4 || partes[0] !== VERSION) throw new ErrorDeDominio("totp_no_disponible");
  try {
    const iv = Buffer.from(partes[1]!, "base64url");
    const cuerpo = Buffer.from(partes[2]!, "base64url");
    const etiqueta = Buffer.from(partes[3]!, "base64url");
    const descifrador = createDecipheriv("aes-256-gcm", llave, iv);
    descifrador.setAAD(Buffer.from(userId));
    descifrador.setAuthTag(etiqueta);
    return Buffer.concat([descifrador.update(cuerpo), descifrador.final()]);
  } catch {
    throw new ErrorDeDominio("totp_no_disponible");
  }
}

/** 32 bytes en base64 o base64url. Cualquier otra cosa no es llave. */
export function llaveDesde(valor: string | undefined): Buffer | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(limpio)) return null;
  const bytes = Buffer.from(limpio.replace(/\+/g, "-").replace(/\//g, "_").replace(/=$/, ""), "base64url");
  return bytes.length === 32 ? bytes : null;
}
