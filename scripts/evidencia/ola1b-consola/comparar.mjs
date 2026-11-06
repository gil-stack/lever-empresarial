// Comparación lado a lado: diseño de los socios, la pantalla antes de Ola 1B
// (main en 81da672) y la pantalla después, en Oscuro a 1440×900.
//
//   DISENO=<carpeta con plat-*.png> ANTES=<capturas de main> node scripts/evidencia/ola1b-consola/comparar.mjs
//
// Las capturas del diseño no viven en el repositorio; las de «antes» salen de
// `node scripts/evidencia/ola1b-consola.mjs pantallas <carpeta>` corrido sobre main.
import { createRequire } from "node:module";

const requerir = createRequire(`${process.cwd()}/package.json`);
const sharp = requerir("sharp");

const DISENO = process.env.DISENO ?? "capturas";
const ANTES = process.env.ANTES ?? "docs/evidencia/ola1b-consola/antes";
const DESPUES = process.env.DESPUES ?? "docs/evidencia/ola1b-consola/pantallas";
const SALIDA = process.env.SALIDA ?? "docs/evidencia/ola1b-consola";

const rotulo = (texto) =>
  Buffer.from(`<svg width="1440" height="44" xmlns="http://www.w3.org/2000/svg"><rect width="1440" height="44" fill="#000" fill-opacity="0.72"/><text x="20" y="29" font-family="Helvetica, Arial" font-size="20" fill="#fff">${texto}</text></svg>`);

async function panel(origen, texto) {
  return sharp(origen).resize(1440, 900, { fit: "cover", position: "top" }).composite([{ input: rotulo(texto), top: 856, left: 0 }]).png().toBuffer();
}

async function comparar({ diseno, pantalla, nombre, salida }) {
  const paneles = [
    await panel(`${DISENO}/${diseno}.png`, `Diseño · ${diseno}`),
    await panel(`${ANTES}/${pantalla}-oscuro-1440.webp`, `Antes · ${nombre} (main 81da672)`),
    await panel(`${DESPUES}/${pantalla}-oscuro-1440.webp`, `Después · ${nombre} (Ola 1B)`),
  ];
  await sharp({ create: { width: 1440 * 3 + 40, height: 900, channels: 3, background: "#000" } })
    .composite(paneles.map((input, i) => ({ input, left: i * 1460, top: 0 })))
    .webp({ quality: 80 })
    .toFile(`${SALIDA}/${salida}`);
  console.log("listo", `${SALIDA}/${salida}`);
}

await comparar({ diseno: "plat-09-proveedores", pantalla: "20-proveedores-pagos", nombre: "Proveedores", salida: "comparacion-proveedores.webp" });
await comparar({ diseno: "plat-10-no-mina", pantalla: "33-personas-nomina", nombre: "Nómina", salida: "comparacion-nomina.webp" });
await comparar({ diseno: "plat-02-aprobaciones", pantalla: "10-pendientes", nombre: "Pendientes", salida: "comparacion-pendientes.webp" });
