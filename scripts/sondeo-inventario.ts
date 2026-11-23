// TEMPORAL: el inventario real del sandbox con el código de main, en un build de producción (no se asigna al dominio). Solo cifras. Se revierte.
import { clienteHttpEfevoo } from "../src/server/efevoo/cliente";
import { configEfevoo } from "../src/server/efevoo/config";
import { armarInventario } from "../src/server/efevoo/inventario";

async function sondear() {
  if (process.env.VERCEL_ENV !== "production") return;
  const config = configEfevoo();
  if (!config) return console.log("SONDEO_INV sin config");
  try {
    const efevoo = clienteHttpEfevoo(config);
    const l = await efevoo.listarTarjetas({ estados: "todas", pagina: 1, tamano: 50 });
    const inv = armarInventario({ efevoo: l.tarjetas, lever: [], vinculos: [], ambiente: config.ambiente, errorEfevoo: null, incompleto: l.paginaFinal > 1 });
    console.log(`SONDEO_INV leidas=${l.tarjetas.length} conteos=${JSON.stringify(inv.conteos)}`);
    console.log(`SONDEO_INV clases=${inv.tarjetas.map((t) => `${t.idEfevoo}:${t.clase}`).join(",")}`);
  } catch (e) {
    console.log(`SONDEO_INV error=${(e as { codigo?: string; detalle?: string })?.codigo} ${(e as Error)?.message}`);
  }
}
void sondear();
