/**
 * Una cookie de preferencia (tema o acento, no de sesión): un año, todo el sitio y `SameSite=Lax`. Lleva `Secure`
 * cuando la página va por https; en localhost por http el navegador no guardaría una cookie `Secure`.
 */
export function cookieDePreferencia(nombre: string, valor: string, protocolo: string): string {
  return `${nombre}=${valor}; Path=/; Max-Age=31536000; SameSite=Lax${protocolo === "https:" ? "; Secure" : ""}`;
}
