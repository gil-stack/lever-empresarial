/**
 * Lo que la base cuenta como carácter de control en `[[:cntrl:]]` (los CHECK de texto y `texto_regulado`).
 * Con el proveedor builtin C.UTF-8 de Neon son C0, DEL y C1: U+0080 a U+009F también, como el U+0085 o las
 * comillas U+0093 y U+0094 de un texto de Windows-1252 mal decodificado. Un texto con uno no cabe en la base.
 */
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Igual, pero deja el tabulador y los saltos de línea de un `textarea`, que se juntan en un espacio antes de guardar. */
export const CONTROL_SALVO_RENGLONES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/**
 * Un texto libre (nombre, concepto, referencia, motivo) sin sus controles invisibles, salvo el tabulador y los
 * saltos de línea, que cada validador junta en un espacio. Lo pegado con un control funciona sin un aviso falso
 * de longitud y la base nunca lo recibe. Los identificadores (RFC, CURP, correo, CLABE) no pasan por aquí:
 * con un control, su forma no es válida.
 */
export function sinControles(texto: string): string {
  return texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}
