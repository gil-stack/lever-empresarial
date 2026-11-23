// TEMPORAL: lee el inventario de Efevoo sandbox con el código nuevo en el build de preview. Solo cifras. Se revierte.
import { clienteHttpEfevoo } from "../src/server/efevoo/cliente";
import { configEfevoo } from "../src/server/efevoo/config";
import { armarInventario } from "../src/server/efevoo/inventario";

async function sondear() {
  if (process.env.VERCEL_ENV !== "preview") return;
  const config = configEfevoo();
  console.log(`SONDEO_INV config=${config ? config.ambiente : "ninguna"}`);
  if (!config) return;
  try {
    const efevoo = clienteHttpEfevoo(config);
    const todas = [];
    for (let p = 1; p <= 40; p++) {
      const l = await efevoo.listarTarjetas({ estados: "todas", pagina: p, tamano: 50 });
      todas.push(...l.tarjetas);
      if (p >= l.paginaFinal || l.tarjetas.length === 0) break;
    }
    const inv = armarInventario({ efevoo: todas, lever: [], vinculos: [], ambiente: config.ambiente, errorEfevoo: null, incompleto: false });
    console.log(`SONDEO_INV leidas=${todas.length} conteos=${JSON.stringify(inv.conteos)}`);
    console.log(`SONDEO_INV clases=${inv.tarjetas.map((t) => `${t.idEfevoo}:${t.clase}`).join(",")}`);
  } catch (e) {
    console.log(`SONDEO_INV error=${(e as { codigo?: string })?.codigo ?? (e as Error)?.name}`);
  }
}
void sondear();
