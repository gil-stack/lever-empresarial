// TEMPORAL: forma cruda de getCardsList (todas) en el sandbox, sin datos personales. Se revierte.
async function sondear() {
  if (process.env.VERCEL_ENV !== "preview") return;
  const url = (process.env.EFEVOO_URL ?? "").trim().replace(/\/+$/, "") + "/v1/apiservice";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-USER": (process.env.EFEVOO_API_USER ?? "").trim(), "X-API-KEY": (process.env.EFEVOO_API_KEY ?? "").trim() },
    body: JSON.stringify({ method: "getCardsList", payload: { status: [], size: 50, page: 1, currency: "MXN", card_bin: "" } }),
  });
  const j = await r.json();
  const resp = j?.response ?? {};
  const meta = Object.fromEntries(Object.entries(resp).filter(([k]) => k !== "cards"));
  console.log(`SONDEO_RAW http=${r.status} code=${j?.status?.code} meta=${JSON.stringify(meta)}`);
  for (const c of Array.isArray(resp.cards) ? resp.cards : []) {
    const bin = typeof c?.bin === "string" ? c.bin.replace(/[0-9](?=[0-9]{4})/g, "#") : `(${typeof c?.bin})`;
    console.log(`SONDEO_RAW id=${JSON.stringify(c?.id)} status=${JSON.stringify(c?.status)} bin=${bin} balance=${JSON.stringify(c?.balance)} subclient=${JSON.stringify(c?.subclient)} product=${JSON.stringify(c?.product)}/${JSON.stringify(c?.subproduct)} email=${typeof c?.email === "string" && c.email.trim() ? "si" : "no"}`);
  }
}
void sondear().catch((e) => console.log(`SONDEO_RAW error=${e?.name}`));
