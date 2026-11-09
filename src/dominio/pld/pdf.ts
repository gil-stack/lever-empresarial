/**
 * Un PDF de texto, sin dependencias: Helvetica con WinAnsiEncoding (cubre los
 * acentos, la ñ y los signos del español), carta vertical y páginas de 50
 * renglones. Sirve para el acta de la sesión del Comité (48ª), que firman el
 * presidente y el secretario fuera de Lever.
 */

const ANCHO = 612;
const ALTO = 792;
const MARGEN = 56;
const RENGLONES_POR_PAGINA = 50;
const INTERLINEA = 13;
const MAXIMO_CARACTERES = 92;

export type RenglonPdf = { texto: string; negrita?: boolean };

/** Parte un párrafo en renglones de a lo más `MAXIMO_CARACTERES`, por palabras. */
export function partirRenglon(texto: string, maximo = MAXIMO_CARACTERES): string[] {
  const palabras = texto.replace(/\s+/g, " ").trim().split(" ");
  const salida: string[] = [];
  let actual = "";
  for (const palabra of palabras) {
    if (palabra.length > maximo) {
      if (actual) salida.push(actual);
      for (let i = 0; i < palabra.length; i += maximo) salida.push(palabra.slice(i, i + maximo));
      actual = "";
      continue;
    }
    const tentativo = actual ? `${actual} ${palabra}` : palabra;
    if (tentativo.length > maximo) {
      salida.push(actual);
      actual = palabra;
    } else {
      actual = tentativo;
    }
  }
  if (actual || salida.length === 0) salida.push(actual);
  return salida;
}

/**
 * WinAnsi no es Latin-1: del 0x80 al 0x9F trae la raya, las comillas tipográficas, los puntos suspensivos, el euro
 * y otros (PDF 32000-1, anexo D). Sin esta tabla, el «—» del acta salía «?» (r2-base-N19).
 */
const WIN_ANSI: Readonly<Record<number, number>> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Texto en WinAnsi (un byte por carácter): lo que no cabe se cambia por «?» para no romper el archivo. */
export function winAnsi(texto: string): string {
  let salida = "";
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 63;
    if ((codigo >= 32 && codigo <= 126) || (codigo >= 160 && codigo <= 255)) salida += caracter;
    else if (WIN_ANSI[codigo] !== undefined) salida += String.fromCharCode(WIN_ANSI[codigo]);
    else salida += "?";
  }
  return salida.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function pdfDeTexto(renglones: readonly RenglonPdf[]): Uint8Array {
  const partidos: RenglonPdf[] = renglones.flatMap((renglon) =>
    partirRenglon(renglon.texto).map((texto) => ({ texto, negrita: renglon.negrita })),
  );
  const paginas: RenglonPdf[][] = [];
  for (let i = 0; i < partidos.length; i += RENGLONES_POR_PAGINA) paginas.push(partidos.slice(i, i + RENGLONES_POR_PAGINA));
  if (paginas.length === 0) paginas.push([]);

  // Objetos: 1 catálogo, 2 páginas, 3 fuente, 4 fuente negrita, luego página y contenido por cada hoja.
  const objetos: string[] = [];
  const idsPaginas = paginas.map((_, indice) => 5 + indice * 2);
  objetos[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objetos[2] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(" ")}] /Count ${paginas.length} >>`;
  objetos[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objetos[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  paginas.forEach((pagina, indice) => {
    const idPagina = 5 + indice * 2;
    const idContenido = idPagina + 1;
    let contenido = "BT\n";
    let y = ALTO - MARGEN;
    for (const renglon of pagina) {
      contenido += `/${renglon.negrita ? "F2" : "F1"} 10 Tf 1 0 0 1 ${MARGEN} ${y} Tm (${winAnsi(renglon.texto)}) Tj\n`;
      y -= INTERLINEA;
    }
    contenido += `/F1 8 Tf 1 0 0 1 ${MARGEN} ${MARGEN / 2} Tm (${winAnsi(`Página ${indice + 1} de ${paginas.length}`)}) Tj\nET`;
    objetos[idPagina] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idContenido} 0 R >>`;
    objetos[idContenido] = `<< /Length ${Buffer.byteLength(contenido, "latin1")} >>\nstream\n${contenido}\nendstream`;
  });

  let cuerpo = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const desplazamientos: number[] = [];
  for (let id = 1; id < objetos.length; id++) {
    desplazamientos[id] = Buffer.byteLength(cuerpo, "latin1");
    cuerpo += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
  }
  const inicioXref = Buffer.byteLength(cuerpo, "latin1");
  cuerpo += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objetos.length; id++) cuerpo += `${String(desplazamientos[id]).padStart(10, "0")} 00000 n \n`;
  cuerpo += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(cuerpo, "latin1"));
}
