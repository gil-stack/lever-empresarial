import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * - efevoo_no_configurado: faltan las variables o no son válidas.
 * - efevoo_rechazo: Efevoo respondió y dijo que no (status.code ≠ 0, una
 *   validación de campos, o un éxito con id 0). Lleva el código de Efevoo.
 * - efevoo_incierto: no se sabe si pasó (timeout, 5xx, sin respuesta o
 *   respuesta ilegible). Una operación de dinero así no se repite hasta conciliarla.
 * - efevoo_no_autorizado: HTTP 401 (credenciales o método no habilitado).
 */
export type CodigoEfevoo = "efevoo_no_configurado" | "efevoo_rechazo" | "efevoo_incierto" | "efevoo_no_autorizado";

export class ErrorEfevoo extends ErrorDeDominio {
  readonly codigo: CodigoEfevoo;
  /** El código que dio Efevoo («101», «115», «validacion», «id_cero», «http_404»…). Nulo si no respondió. */
  readonly codigoEfevoo: string | null;

  constructor(codigo: CodigoEfevoo, codigoEfevoo: string | null = null) {
    super(codigo);
    this.name = "ErrorEfevoo";
    this.codigo = codigo;
    this.codigoEfevoo = codigoEfevoo;
  }
}

export function esErrorEfevoo(error: unknown, codigo?: CodigoEfevoo): error is ErrorEfevoo {
  return error instanceof ErrorEfevoo && (codigo === undefined || error.codigo === codigo);
}
