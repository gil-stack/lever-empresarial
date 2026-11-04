/** A dónde se vuelve después de entrar. Solo las puertas que ya existen. */
const DESTINOS = new Set(["/consola", "/telefono"]);

export function destinoSeguro(valor: unknown): string {
  return typeof valor === "string" && DESTINOS.has(valor) ? valor : "/consola";
}
