import type { AltaCuenta } from "./tipos";

const CORREO = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

export type CuentaValida = {
  nombre: string;
  correo: string;
  contrasena: string;
};

export type ResultadoCuenta =
  | { ok: true; valor: CuentaValida }
  | { ok: false; codigo: "nombre_invalido" | "correo_invalido" | "contrasena_invalida" };

export function normalizarCorreo(valor: string): string {
  return valor.trim().toLowerCase();
}

export function validarCuenta(entrada: AltaCuenta | null | undefined): ResultadoCuenta {
  const nombre = normalizarNombre(entrada?.nombre);
  if (!nombre) return { ok: false, codigo: "nombre_invalido" };
  const correo = typeof entrada?.correo === "string" ? normalizarCorreo(entrada.correo) : "";
  if (!correoValido(correo)) return { ok: false, codigo: "correo_invalido" };
  const contrasena = typeof entrada?.contrasena === "string" ? entrada.contrasena : "";
  if (!contrasenaValida(contrasena)) return { ok: false, codigo: "contrasena_invalida" };
  return { ok: true, valor: { nombre, correo, contrasena } };
}

export function correoValido(correo: string): boolean {
  return correo.length <= 254 && CORREO.test(correo);
}

function normalizarNombre(valor: unknown): string | null {
  if (typeof valor !== "string" || CONTROL.test(valor)) return null;
  const nombre = valor.trim().replace(/\s+/g, " ");
  if (nombre.length < 1 || nombre.length > 120) return null;
  if (!/[\p{L}\p{N}]/u.test(nombre)) return null;
  return nombre;
}

function contrasenaValida(contrasena: string): boolean {
  if (contrasena.length < 10 || contrasena.trim().length === 0) return false;
  // bcrypt solo usa los primeros 72 bytes y truncaría en silencio.
  return Buffer.byteLength(contrasena, "utf8") <= 72;
}
