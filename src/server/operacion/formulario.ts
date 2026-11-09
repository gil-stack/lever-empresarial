import { caracteresVisibles } from "../../dominio/control";
import { textoMultilinea } from "../../dominio/operacion";
import type { Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * Envuelve la transacción de la escritura de un formulario. En producción no hace nada; la prueba de la carrera
 * de dos pestañas la usa para que la otra pestaña confirme justo después de la primera lectura.
 */
export type EnvolturaDeTransaccion = (consulta: Consulta) => Consulta;

/** Lo mínimo de un motivo que queda en la bitácora y lee otra persona, como el de personal:rol. */
export const MOTIVO_MINIMO = 10;

/**
 * El motivo escrito, de 10 caracteres al tope: uno más corto no explica nada («motivo_corto»).
 * Cuenta caracteres, como `char_length` en los CHECK de la 0028, no unidades UTF-16: «Revisar 😀»
 * son 9 y no pasa. Y cuenta solo los que se ven: diez U+3164 pasan el CHECK de la base, pero aquí no
 * hay motivo («motivo_invalido»), y «Revisar» con tres U+3164 son 7.
 */
export function motivoEscrito(valor: unknown, maximo: number): string {
  const limpio = textoMultilinea(valor, maximo);
  if (!limpio) throw new ErrorDeDominio("motivo_invalido");
  if (caracteresVisibles(limpio) < MOTIVO_MINIMO) throw new ErrorDeDominio("motivo_corto");
  return limpio;
}

/**
 * Doble envío concurrente del mismo formulario (dos pestañas o un reintento del
 * navegador): la base deja una sola fila y a quien llegó segundo le responde con
 * la llave repetida («formulario_ya_aplicado»). Se repite la operación una vez:
 * ahora encuentra la fila y sale igual que un segundo clic en secuencia. Si vuelve
 * a chocar, ese identificador es de otra cosa y se rechaza con `ajeno`.
 */
export async function unaVezPorFormulario<T>(operacion: () => Promise<T>, ajeno = "expediente_ausente"): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    if (!(error instanceof ErrorDeDominio) || error.codigo !== "formulario_ya_aplicado") throw error;
  }
  try {
    return await operacion();
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.codigo === "formulario_ya_aplicado") throw new ErrorDeDominio(ajeno);
    throw error;
  }
}
