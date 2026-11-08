/**
 * Lo que la base cuenta como carácter de control en `[[:cntrl:]]` (los CHECK de texto y `texto_regulado`).
 * Con el proveedor builtin C.UTF-8 de Neon son C0, DEL y C1: U+0080 a U+009F también, como el U+0085 o las
 * comillas U+0093 y U+0094 de un texto de Windows-1252 mal decodificado. Un texto con uno no cabe en la base.
 */
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Las comillas de Windows-1252 leídas como C1 (U+0091 a U+0094) valen la comilla que eran. */
const COMILLAS: Record<string, string> = { "\u0091": "'", "\u0092": "'", "\u0093": '"', "\u0094": '"' };

/**
 * Un texto libre (motivo, giro, concepto, nota, nombre del cliente de un cobro, nombre del CFDI que no se coteja)
 * sin sus controles invisibles. Cada control vale un espacio, para no pegar dos palabras («Comercializadora» y
 * «Uno»), salvo las comillas de Windows-1252 mal decodificadas: U+0091 y U+0092 valen «'» («O'Brien») y U+0093 y
 * U+0094 valen «"». Después junta los espacios y recorta. La base nunca recibe el control.
 *
 * Las identidades y los identificadores no pasan por aquí: los nombres que se cotejan contra la Lista o el 69-B
 * (representantes, socios, razón social, proveedores), RFC, CURP, correo, CLABE, folios y áreas rechazan
 * cualquier control con el error de su campo. Un dato de identidad queda como lo escribió la persona.
 */
export function sinControles(texto: string): string {
  return texto
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (control) => COMILLAS[control] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}
