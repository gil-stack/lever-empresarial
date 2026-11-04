import { createHash, randomBytes } from "node:crypto";

import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

const RONDAS_BCRYPT = 12;

type ApiBcrypt = {
  hash: (dato: string, rondas: number) => Promise<string>;
  compare: (dato: string, hash: string) => Promise<boolean>;
};

export function hashDeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenNuevo(): string {
  return randomBytes(32).toString("base64url");
}

export async function hashearContrasena(contrasena: string): Promise<string> {
  const lib = await api();
  return lib.hash(contrasena, RONDAS_BCRYPT);
}

export async function verificarContrasena(contrasena: string, hash: string): Promise<boolean> {
  try {
    const lib = await api();
    return await lib.compare(contrasena, hash);
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    return false;
  }
}

async function api(): Promise<ApiBcrypt> {
  try {
    const modulo = (await import("bcryptjs")) as ApiBcrypt & { default?: ApiBcrypt };
    if (typeof modulo.hash === "function" && typeof modulo.compare === "function") return modulo;
    if (
      modulo.default &&
      typeof modulo.default.hash === "function" &&
      typeof modulo.default.compare === "function"
    ) {
      return modulo.default;
    }
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
  }
  throw new ErrorDeDominio("contrasena_no_disponible");
}
