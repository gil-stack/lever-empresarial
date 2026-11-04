export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidValido(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

export function textoOperativo(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string" || /[\u0000-\u001f\u007f]/.test(valor)) return null;
  const limpio = valor.trim().replace(/\s+/g, " ");
  return limpio.length > 0 && limpio.length <= maximo ? limpio : null;
}

export function textoMultilinea(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(valor)) return null;
  const limpio = valor.trim();
  return limpio.length > 0 && limpio.length <= maximo ? limpio : null;
}
