// TEMPORAL: prueba de solo lectura de las llaves de sandbox de Efevoo en el build de preview.
// No imprime llaves. Nunca detiene el build.
const env = process.env;
if (env.VERCEL_ENV !== "preview") process.exit(0);
const url = (env.EFEVOO_URL ?? "").trim().replace(/\/+$/, "") + "/v1/apiservice";
const usuario = (env.EFEVOO_API_USER ?? "").trim();
const llave = (env.EFEVOO_API_KEY ?? "").trim();
console.log(`SONDEO_EFEVOO ambiente=${env.EFEVOO_AMBIENTE} usuario_presente=${usuario.length > 0} largo_usuario=${usuario.length} llave_presente=${llave.length > 0} largo_llave=${llave.length}`);
async function llamar(method, payload) {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-USER": usuario, "X-API-KEY": llave },
      body: JSON.stringify({ method, payload }),
      signal: corte.signal,
    });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch {}
    const status = json?.status ?? null;
    const resp = json?.response ?? null;
    const resumen = resp && typeof resp === "object" ? Object.keys(resp).slice(0, 8).join(",") : typeof resp;
    const total = resp?.total_cards ?? (Array.isArray(resp) ? resp.length : undefined);
    console.log(`SONDEO_EFEVOO metodo=${method} http=${r.status} code=${status?.code} mensaje=${JSON.stringify(status?.message ?? status?.description ?? null)} campos=${resumen} total=${total}`);
  } catch (e) {
    console.log(`SONDEO_EFEVOO metodo=${method} error=${corte.signal.aborted ? "timeout" : e?.name}`);
  } finally {
    clearTimeout(reloj);
  }
}
await llamar("getCardsList", { status: [], size: 1, page: 1, currency: "MXN", card_bin: "" });
await llamar("getClientList", { idepClientes: [] });
