import type { CorreoPlantilla } from "../tipos";

/**
 * El marco de los correos. Los colores son los de `src/estilo/tokens.css`
 * (papel, hoja, tinta, línea y sello), en claro y en oscuro. Los clientes de
 * correo no cargan las fuentes de la consola, así que la familia cae a las
 * mismas alternativas que declara la hoja.
 */

const CLARO = {
  papel: "#f3f1ec",
  hoja: "#fffefb",
  tinta: "#16140f",
  tintaSuave: "#5d584f",
  tintaTenue: "#736d62",
  linea: "#e4dfd5",
  sello: "#0c5c48",
  sobreSello: "#fbfaf6",
} as const;

const OSCURO = {
  papel: "#0f0f0d",
  hoja: "#171715",
  tinta: "#eeeae2",
  tintaSuave: "#a9a399",
  tintaTenue: "#8a857b",
  linea: "#272623",
  sello: "#63c7a3",
  sobreSello: "#05221a",
} as const;

// Comillas simples: estas pilas viven dentro de style="…".
const DISPLAY = `'Iowan Old Style', Palatino, 'Palatino Linotype', Georgia, serif`;
const SANS = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`;

const FECHA = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type Bloque = {
  kicker: string;
  titulo: string;
  parrafos: readonly string[];
  /** Pares de etiqueta y valor; el valor va en mono (RFC, correo). */
  datos?: ReadonlyArray<readonly [string, string]>;
  boton: { texto: string; url: string };
  notas: readonly string[];
  preencabezado: string;
};

export function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fechaEnMexico(instante: Date): string {
  return `${FECHA.format(instante)} (hora del centro de México)`;
}

export function armarCorreo(asunto: string, bloque: Bloque): CorreoPlantilla {
  return { asunto: sinSaltos(asunto), html: html(asunto, bloque), texto: texto(bloque) };
}

function html(asunto: string, b: Bloque): string {
  const url = escapar(b.boton.url);
  const parrafos = b.parrafos
    .map(
      (p) =>
        `<p class="suave" style="margin:0 0 16px;color:${CLARO.tintaSuave};font-family:${SANS};font-size:16px;line-height:1.6;">${escapar(p)}</p>`,
    )
    .join("");
  const datos = (b.datos ?? [])
    .map(
      ([etiqueta, valor]) =>
        `<tr><td class="tenue filo" style="padding:10px 0;border-top:1px solid ${CLARO.linea};color:${CLARO.tintaTenue};font-family:${SANS};font-size:14px;">${escapar(etiqueta)}</td>` +
        `<td align="right" class="tinta filo" style="padding:10px 0;border-top:1px solid ${CLARO.linea};color:${CLARO.tinta};font-family:${MONO};font-size:14px;">${escapar(valor)}</td></tr>`,
    )
    .join("");
  const tablaDatos = datos
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-collapse:collapse;">${datos}</table>`
    : "";
  const notas = b.notas
    .map(
      (n) =>
        `<p class="tenue" style="margin:0 0 8px;color:${CLARO.tintaTenue};font-family:${SANS};font-size:13px;line-height:1.5;">${escapar(n)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapar(asunto)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .papel { background:${OSCURO.papel} !important; }
  .hoja { background:${OSCURO.hoja} !important; border-color:${OSCURO.linea} !important; }
  .tinta { color:${OSCURO.tinta} !important; }
  .suave { color:${OSCURO.tintaSuave} !important; }
  .tenue { color:${OSCURO.tintaTenue} !important; }
  .filo { border-color:${OSCURO.linea} !important; }
  .sello { background:${OSCURO.sello} !important; color:${OSCURO.sobreSello} !important; }
  .marca-sello { background:${OSCURO.sello} !important; }
  .enlace { color:${OSCURO.sello} !important; }
}
</style>
</head>
<body class="papel" style="margin:0;padding:0;background:${CLARO.papel};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(b.preencabezado)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="papel" style="background:${CLARO.papel};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 20px;">
<span class="marca-sello" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CLARO.sello};vertical-align:middle;"></span>
<span class="tinta" style="margin-left:8px;color:${CLARO.tinta};font-family:${DISPLAY};font-size:18px;vertical-align:middle;">Plataforma</span>
</td></tr>
<tr><td class="hoja" style="padding:36px 32px 32px;background:${CLARO.hoja};border:1px solid ${CLARO.linea};border-radius:16px;">
<p class="suave" style="margin:0 0 18px;color:${CLARO.tintaSuave};font-family:${MONO};font-size:11px;letter-spacing:0.16em;text-transform:uppercase;">${escapar(b.kicker)}</p>
<h1 class="tinta" style="margin:0 0 20px;color:${CLARO.tinta};font-family:${DISPLAY};font-size:28px;font-weight:normal;line-height:1.15;letter-spacing:-0.02em;">${escapar(b.titulo)}</h1>
${parrafos}
${tablaDatos}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;"><tr><td class="sello" style="border-radius:10px;background:${CLARO.sello};">
<a href="${url}" class="sello" style="display:inline-block;padding:13px 22px;border-radius:10px;background:${CLARO.sello};color:${CLARO.sobreSello};font-family:${SANS};font-size:15px;font-weight:600;text-decoration:none;">${escapar(b.boton.texto)}</a>
</td></tr></table>
<p class="tenue" style="margin:0 0 6px;color:${CLARO.tintaTenue};font-family:${SANS};font-size:13px;line-height:1.5;">Si el botón no abre, copia esta dirección en el navegador:</p>
<p style="margin:0 0 24px;font-family:${MONO};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${url}" class="enlace" style="color:${CLARO.sello};">${url}</a></p>
<div class="filo" style="border-top:1px solid ${CLARO.linea};padding-top:18px;">${notas}</div>
</td></tr>
<tr><td style="padding:20px 4px 0;">
<p class="tenue" style="margin:0;color:${CLARO.tintaTenue};font-family:${SANS};font-size:12px;line-height:1.5;">Correo automático de la plataforma. No respondas a esta dirección.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function texto(b: Bloque): string {
  const datos = (b.datos ?? []).map(([etiqueta, valor]) => `${etiqueta}: ${valor}`);
  return [
    b.titulo,
    "",
    ...b.parrafos.flatMap((p) => [p, ""]),
    ...(datos.length > 0 ? [...datos, ""] : []),
    `${b.boton.texto}:`,
    b.boton.url,
    "",
    ...b.notas,
    "",
    "Correo automático de la plataforma. No respondas a esta dirección.",
  ].join("\n");
}

function sinSaltos(valor: string): string {
  return valor.replace(/[\r\n]+/g, " ").trim();
}
