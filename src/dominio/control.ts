/**
 * Lo que la base cuenta como carácter de control en `[[:cntrl:]]` (los CHECK de texto y `texto_regulado`).
 * Con el proveedor builtin C.UTF-8 de Neon son C0, DEL y C1: U+0080 a U+009F también, como el U+0085 o las
 * comillas U+0093 y U+0094 de un texto de Windows-1252 mal decodificado. Un texto con uno no cabe en la base.
 */
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Lo que una identidad o un identificador no admite: los controles (Cc, lo mismo que `CONTROL`) y los caracteres
 * de formato (Cf), que no se ven pero cambian el texto: el guion suave U+00AD, el espacio de ancho cero U+200B,
 * las marcas de dirección U+200E y U+200F, la unión de palabras U+2060 o el U+FEFF. Un nombre con uno se ve igual
 * en pantalla, pero no coincide letra por letra con la Lista ni con el 69-B. Suelen llegar al copiar y pegar.
 *
 * Los textos libres no usan esta regla (ver `sinControles`): un motivo con un emoji compuesto (unido con U+200D) se
 * acepta tal cual.
 *
 * Límite que queda: un homoglifo no es invisible. Una «а» cirílica (U+0430) en lugar de la «a» latina pasa esta
 * regla y el cotejo por nombre no la junta con la persona de la Lista. Lo revisa Cumplimiento contra el documento
 * de identidad, y el RFC o la CURP (que solo admiten letras y dígitos latinos) siguen siendo la llave fuerte.
 */
export const INVISIBLE = /[\p{Cc}\p{Cf}]/u;

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
 * cualquier carácter invisible (`INVISIBLE`) con el error de su campo. Un dato de identidad queda como lo escribió
 * la persona.
 */
export function sinControles(texto: string): string {
  return texto
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (control) => COMILLAS[control] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}
