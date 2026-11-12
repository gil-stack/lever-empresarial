/**
 * Lever guarda centavos enteros; Efevoo recibe y devuelve pesos. La conversión
 * es con texto y enteros, sin flotantes intermedios: 1234 centavos → "12.34".
 */

/** Tope de un monto que se manda a Efevoo: 9 999 999 999.99 pesos. */
export const TOPE_CENTAVOS = 999_999_999_999;

/** Centavos enteros positivos → pesos con 2 decimales exactos, como texto. */
export function centavosAPesos(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 1 || centavos > TOPE_CENTAVOS) {
    throw new Error("centavos_invalidos");
  }
  const texto = String(centavos).padStart(3, "0");
  return `${texto.slice(0, -2)}.${texto.slice(-2)}`;
}

/**
 * Lo que regresa Efevoo (número como 501.01 o texto como "500.0000") → centavos.
 * Más de dos decimales se redondean a centavos, la mitad hacia afuera del cero.
 * Nulo si no es un monto: nunca se adivina.
 */
export function pesosACentavos(valor: unknown): number | null {
  let texto: string;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    texto = String(valor);
  } else if (typeof valor === "string") {
    texto = valor.trim();
  } else {
    return null;
  }
  const forma = /^(-?)(\d{1,15})(?:\.(\d{1,12}))?$/.exec(texto);
  if (!forma) return null;
  const [, signo, entero, fraccion = ""] = forma;
  const digitos = (fraccion + "000").slice(0, 3);
  let centavos = BigInt(entero!) * BigInt(100) + BigInt(digitos.slice(0, 2));
  if (Number(digitos[2]) >= 5) centavos += BigInt(1);
  const resultado = Number(centavos);
  if (!Number.isSafeInteger(resultado)) return null;
  return signo === "-" && resultado !== 0 ? -resultado : resultado;
}
