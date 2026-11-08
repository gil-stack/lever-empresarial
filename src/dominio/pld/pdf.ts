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

/** Texto en WinAnsi: lo que no cabe se cambia por «?» para no romper el archivo. */
function winAnsi(texto: string): string {
  let salida = "";
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 63;
    salida += codigo >= 32 && codigo <= 255 && codigo !== 127 ? caracter : "?";
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
