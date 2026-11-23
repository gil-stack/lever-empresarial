// TEMPORAL: lee el inventario de Efevoo sandbox con el código nuevo en el build de preview. Solo cifras. Se revierte.
import { clienteHttpEfevoo } from "../src/server/efevoo/cliente";
import { configEfevoo } from "../src/server/efevoo/config";
import { armarInventario } from "../src/server/efevoo/inventario";

async function sondear(intento = 1): Promise<void> {
  if (process.env.VERCEL_ENV !== "preview") return;
  const config = configEfevoo();
  if (intento === 1) {
    const crudo = (process.env.EFEVOO_URL ?? "").trim().replace(/\/+$/, "") + "/v1/apiservice";
    console.log(`SONDEO_INV misma_url=${config?.url === crudo} ruta_config=${config ? new URL(config.url).pathname : "-"} ruta_cruda=${new URL(crudo).pathname}`);
    const r = await fetch(crudo, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-USER": (process.env.EFEVOO_API_USER ?? "").trim(), "X-API-KEY": (process.env.EFEVOO_API_KEY ?? "").trim() }, body: JSON.stringify({ method: "getCardsList", payload: { status: [], size: 50, page: 1, currency: "MXN", card_bin: "" } }) });
    console.log(`SONDEO_INV crudo_http=${r.status}`);
  }
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
    console.log(`SONDEO_INV intento=${intento} error=${(e as { codigo?: string })?.codigo ?? (e as Error)?.name}`);
    if (intento < 4) {
      await new Promise((r) => setTimeout(r, 5000));
      return sondear(intento + 1);
    }
  }
}
void sondear();
