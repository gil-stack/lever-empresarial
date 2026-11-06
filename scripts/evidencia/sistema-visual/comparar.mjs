// Comparación lado a lado con el diseño: Inicio del producto junto a plat-00-resumen y la tabla
// del sistema junto a plat-04-tarjetas. Uso: node comparar.mjs
import { createRequire } from "node:module";
import { BASE, EVIDENCIA, abrir } from "./comun.mjs";

const requerir = createRequire(`${process.cwd()}/package.json`);
const sharp = requerir("sharp");
const EVID = EVIDENCIA;
// Capturas del diseño de los socios (no viven en el repositorio).
const DISENO = process.env.DISENO ?? "capturas";

// Tabla del sistema (muestrario) en Oscuro, 1440×900, centrada en la tabla
const { nav, p } = await abrir({ tema: "oscuro" });
await p.goto(`${BASE}/muestrario`, { waitUntil: "networkidle" });
await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
const ejemplo = p.locator(".superficies-de-ejemplo");
await ejemplo.evaluate((el) => el.scrollIntoView({ block: "center" }));
await p.waitForTimeout(900);
const tablaProducto = await p.screenshot();
await nav.close();

const rotulo = (texto) =>
  Buffer.from(`<svg width="1440" height="44" xmlns="http://www.w3.org/2000/svg"><rect width="1440" height="44" fill="#000" fill-opacity="0.72"/><text x="20" y="29" font-family="Helvetica, Arial" font-size="20" fill="#fff">${texto}</text></svg>`);

async function lado(izq, der, salida, rotuloIzq, rotuloDer) {
  const a = await sharp(izq).resize(1440, 900, { fit: "cover", position: "top" }).composite([{ input: rotulo(rotuloIzq), top: 856, left: 0 }]).png().toBuffer();
  const b = await sharp(der).resize(1440, 900, { fit: "cover", position: "top" }).composite([{ input: rotulo(rotuloDer), top: 856, left: 0 }]).png().toBuffer();
  await sharp({ create: { width: 2900, height: 900, channels: 3, background: "#000" } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 1460, top: 0 }])
    .webp({ quality: 82 })
    .toFile(salida);
  console.log("listo", salida);
}

await lado(`${DISENO}/plat-00-resumen.png`, `${EVID}/10-inicio-oscuro-1440.webp`, `${EVID}/comparacion-inicio.webp`, "Diseño · plat-00-resumen", "Producto · Inicio (Oscuro, 1440×900)");
await lado(`${DISENO}/plat-04-tarjetas.png`, tablaProducto, `${EVID}/comparacion-tabla.webp`, "Diseño · plat-04-tarjetas", "Producto · tabla del sistema (muestrario, Oscuro)");
