import type { CorreoPlantilla } from "../tipos";

/**
 * Colores de src/estilo/tokens.css (Lever Empresas), en claro y en oscuro: fondo
 * (--void), hoja (--s1), textos (--tx, --tx2, --tx3) y el botón principal marfil
 * (--ivory con --ivk). La línea es --line ya mezclada sobre la hoja, porque varios
 * clientes de correo no entienden la transparencia.
 */
const CLARO = {
  papel: "#ece6de",
  hoja: "#fbf8f4",
  tinta: "#141312",
  tintaSuave: "#4f4a45",
  tintaTenue: "#57524d",
  linea: "#e4e1dd",
  boton: "#1b1614",
  sobreBoton: "#ffffff",
} as const;

const OSCURO = {
  papel: "#0e0a08",
  hoja: "#15100e",
  tinta: "#edf0ed",
  tintaSuave: "#bdbab8",
  tintaTenue: "#aeaba9",
  linea: "#25211f",
  boton: "#f1f2ee",
  sobreBoton: "#0c0b0b",
} as const;

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif`;
/** Títulos en Sora fina como el producto; donde el cliente de correo no la tiene, la del sistema. */
const TITULO = `Sora, ${SANS}`;
const MONO = `'SF Mono', ui-monospace, 'IBM Plex Mono', Menlo, Consolas, monospace`;
const LOGO = "https://www.leverpagos.com/lever-email.png";

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
  datos?: ReadonlyArray<readonly [string, string]>;
  boton: { texto: string; url: string };
  notas: readonly string[];
  preencabezado: string;
  /** El pie bajo la hoja. Sin él, el de los correos automáticos de Lever. */
  pie?: string;
};

const PIE = "LEVER · Finanzas empresariales en orden. Correo automático, no respondas a esta dirección.";

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
    .map((p) => `<p class="suave" style="margin:0 0 17px;color:${CLARO.tintaSuave};font-family:${SANS};font-size:16px;line-height:1.65;">${escapar(p)}</p>`)
    .join("");
  const datos = (b.datos ?? [])
    .map(([etiqueta, valor]) =>
      `<tr><td class="tenue filo" style="padding:11px 0;border-top:1px solid ${CLARO.linea};color:${CLARO.tintaTenue};font-family:${SANS};font-size:14px;">${escapar(etiqueta)}</td>` +
      `<td align="right" class="tinta filo" style="padding:11px 0;border-top:1px solid ${CLARO.linea};color:${CLARO.tinta};font-family:${SANS};font-size:14px;font-weight:500;">${escapar(valor)}</td></tr>`,
    )
    .join("");
  const tablaDatos = datos
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 26px;border-collapse:collapse;">${datos}</table>`
    : "";
  const notas = b.notas
    .map((n) => `<p class="tenue" style="margin:0 0 8px;color:${CLARO.tintaTenue};font-family:${SANS};font-size:13px;line-height:1.55;">${escapar(n)}</p>`)
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
  .boton { background:${OSCURO.boton} !important; color:${OSCURO.sobreBoton} !important; }
  .enlace { color:${OSCURO.tinta} !important; }
}
</style>
</head>
<body class="papel" style="margin:0;padding:0;background:${CLARO.papel};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(b.preencabezado)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="papel" style="background:${CLARO.papel};">
<tr><td align="center" style="padding:36px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
<tr><td style="padding:0 4px 20px;">
<img src="${LOGO}" alt="Lever Empresas" width="260" height="67" style="display:block;width:260px;max-width:100%;height:auto;border-radius:8px;">
</td></tr>
<tr><td class="hoja" style="padding:36px 32px 32px;background:${CLARO.hoja};border:1px solid ${CLARO.linea};border-radius:16px;">
<p class="tenue" style="margin:0 0 18px;color:${CLARO.tintaTenue};font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;">${escapar(b.kicker)}</p>
<h1 class="tinta" style="margin:0 0 22px;color:${CLARO.tinta};font-family:${TITULO};font-size:30px;font-weight:300;line-height:1.18;letter-spacing:-0.02em;">${escapar(b.titulo)}</h1>
${parrafos}
${tablaDatos}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;"><tr><td class="boton" style="border-radius:10px;background:${CLARO.boton};">
<a href="${url}" class="boton" style="display:inline-block;padding:14px 23px;border-radius:10px;background:${CLARO.boton};color:${CLARO.sobreBoton};font-family:${SANS};font-size:15px;font-weight:500;text-decoration:none;">${escapar(b.boton.texto)}</a>
</td></tr></table>
<p class="tenue" style="margin:0 0 6px;color:${CLARO.tintaTenue};font-family:${SANS};font-size:13px;line-height:1.5;">Si el botón no abre, copia esta dirección en el navegador:</p>
<p style="margin:0 0 24px;font-family:${MONO};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${url}" class="enlace" style="color:${CLARO.tinta};">${url}</a></p>
<div class="filo" style="border-top:1px solid ${CLARO.linea};padding-top:18px;">${notas}</div>
</td></tr>
<tr><td style="padding:20px 4px 0;">
<p class="tenue" style="margin:0;color:${CLARO.tintaTenue};font-family:${SANS};font-size:12px;line-height:1.5;">${escapar(b.pie ?? PIE)}</p>
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
    b.pie ?? PIE,
  ].join("\n");
}

function sinSaltos(valor: string): string {
  return valor.replace(/[\r\n]+/g, " ").trim();
}
