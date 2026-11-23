// TEMPORAL: diagnóstico de solo lectura del sandbox de Efevoo en el build de preview. No imprime llaves ni datos personales.
const env = process.env;
if (env.VERCEL_ENV !== "preview") process.exit(0);
const usuario = (env.EFEVOO_API_USER ?? "").trim();
const llave = (env.EFEVOO_API_KEY ?? "").trim();
const base = (env.EFEVOO_URL ?? "").trim();
console.log(`SONDEO base_host=${(() => { try { return new URL(base).host + new URL(base).pathname; } catch { return "invalida"; } })()} ambiente=${env.EFEVOO_AMBIENTE} largo_usuario=${usuario.length} largo_llave=${llave.length}`);
const limpiar = (t) => t.replace(/[\w.+-]+@[\w.-]+/g, "<correo>").replace(/\s+/g, " ").slice(0, 220);
async function probar(etiqueta, url, cuerpo, metodo = "POST", conLlaves = true) {
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(conLlaves ? { "X-API-USER": usuario, "X-API-KEY": llave } : {}) },
      body: metodo === "POST" ? JSON.stringify(cuerpo) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const t = await r.text();
    let resumen = "";
    try { const j = JSON.parse(t); resumen = `code=${j?.status?.code} msg=${JSON.stringify(j?.status?.message ?? j?.message ?? null)} total=${j?.response?.total_cards}`; } catch { resumen = `cuerpo=${limpiar(t)}`; }
    console.log(`SONDEO ${etiqueta} http=${r.status} server=${r.headers.get("server")} ${resumen}`);
  } catch (e) {
    console.log(`SONDEO ${etiqueta} error=${e?.name} ${e?.cause?.code ?? ""}`);
  }
}
const lista = { method: "getCardsList", payload: { status: [], size: 5, page: 1, currency: "MXN", card_bin: "" } };
for (const host of ["https://test-intgapi.efevoopay.com", "https://test-test-intgapi.efevoopay.com"]) {
  await probar(`${host} lista`, `${host}/v1/apiservice`, lista);
  await probar(`${host} clientes`, `${host}/v1/apiservice`, { method: "getClientList", payload: { idepClientes: [] } });
  await probar(`${host} sin_llaves`, `${host}/v1/apiservice`, lista, "POST", false);
  await probar(`${host} raiz`, `${host}/`, null, "GET", false);
}
