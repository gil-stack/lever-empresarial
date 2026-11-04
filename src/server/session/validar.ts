const CORREO = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function normalizarCorreo(valor: string): string {
  return valor.trim().toLowerCase();
}

export function correoValido(correo: string): boolean {
  return correo.length <= 254 && CORREO.test(correo);
}
