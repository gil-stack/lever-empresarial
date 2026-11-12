/**
 * Registros del servidor de la integración con Efevoo. Solo llevan datos
 * técnicos que la persona que los escribe nombra explícitamente: método, código
 * de Efevoo, estado HTTP, milisegundos e ids internos. Nunca la llave, nombres,
 * correos, teléfonos, domicilios ni la respuesta cruda. Como segunda pared,
 * toda secuencia de 13 a 19 dígitos (con o sin espacios, guiones o asteriscos
 * entre ellos) se borra antes de escribir: un número de tarjeta no sale nunca.
 */

export type DatosDeRegistro = {
  metodo?: string;
  codigo?: string | null;
  http?: number | null;
  ms?: number;
  operacionId?: string;
  companyId?: string;
  motivo?: string;
};

const PERMITIDOS = new Set<keyof DatosDeRegistro>(["metodo", "codigo", "http", "ms", "operacionId", "companyId", "motivo"]);

/** Borra cualquier corrida de 13 a 19 dígitos, aunque traiga separadores entre ellos. */
export function sinNumerosDeTarjeta(texto: string): string {
  return texto.replace(/\d(?:[\s*.-]*\d){12,}/g, (corrida) => {
    const digitos = corrida.replace(/\D/g, "").length;
    return digitos >= 13 ? "[redactado]" : corrida;
  });
}

export type Escritor = (linea: string) => void;

export function registrarEfevoo(
  nivel: "info" | "error",
  evento: string,
  datos: DatosDeRegistro = {},
  escribir: Escritor = nivel === "error" ? console.error : console.info,
): void {
  const limpio: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (!PERMITIDOS.has(clave as keyof DatosDeRegistro) || valor === undefined) continue;
    limpio[clave] = typeof valor === "string" ? valor.slice(0, 120) : valor;
  }
  escribir(sinNumerosDeTarjeta(JSON.stringify({ nivel, origen: "efevoo", evento: evento.slice(0, 64), ...limpio })));
}
