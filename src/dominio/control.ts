/**
 * Lo que la base cuenta como carácter de control en `[[:cntrl:]]` (los CHECK de texto y `texto_regulado`).
 * Con el proveedor builtin C.UTF-8 de Neon son C0, DEL y C1: U+0080 a U+009F también, como el U+0085 o las
 * comillas U+0093 y U+0094 de un texto de Windows-1252 mal decodificado. Un texto con uno no cabe en la base.
 */
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Lo que una identidad o un identificador no admite: lo que no se ve pero cambia el texto. Son los controles (Cc, lo
 * mismo que `CONTROL`), los caracteres de formato (Cf: el guion suave U+00AD, el espacio de ancho cero U+200B, las
 * marcas de dirección U+200E y U+200F, la unión de palabras U+2060, el U+FEFF) y los demás que Unicode marca para
 * no dibujarse (Default_Ignorable_Code_Point, en otras categorías): el relleno hangul U+3164, U+115F y U+FFA0, los
 * selectores de variación U+FE0F, U+180B y U+E0100 y la vocal muda jemer U+17B4. Un nombre con uno se ve igual en
 * pantalla, pero `lpb_normalizar` parte la palabra donde está («Rodr\u3164íguez» da «IGUEZ RODR») y ya no coincide
 * con la Lista ni con el 69-B. Suelen llegar al copiar y pegar.
 *
 * Los textos libres no usan esta regla (ver `sinControles`): un motivo con un emoji compuesto (unido con U+200D) o con
 * el selector de emoji U+FE0F («❤️») se acepta tal cual.
 *
 * Límite que queda: un homoglifo no es invisible. Una «а» cirílica (U+0430) en lugar de la «a» latina pasa esta
 * regla y el cotejo por nombre no la junta con la persona de la Lista. Lo revisa Cumplimiento contra el documento
 * de identidad, y el RFC o la CURP (que solo admiten letras y dígitos latinos) siguen siendo la llave fuerte.
 */
export const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

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
