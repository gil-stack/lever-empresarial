import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

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
