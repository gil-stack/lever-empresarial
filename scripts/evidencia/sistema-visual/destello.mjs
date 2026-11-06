// Mide si el acento de un tono propio cambia después del primer cuadro (destello).
// Uso (desde la raíz del repositorio): SV=... EMPRESA_ALTAMAR=... node scripts/evidencia/sistema-visual/destello.mjs <salida.json>
import { readFileSync, writeFileSync } from "node:fs";
import { ALTAMAR_ID, BASE, CLAVE, SV, abrir, totp } from "./comun.mjs";

const salida = process.argv[2];
const { nav, ctx, p } = await abrir({ tema: "oscuro" });
await p.goto(`${BASE}/entrar`);
await p.getByLabel("Correo").fill("laura@lever.test");
await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
await p.locator("form button[type=submit]").first().click();
await p.waitForURL(/continuar/);
await p.locator("#codigo").fill(await totp(readFileSync(`${SV}/semilla-laura.txt`, "utf8").trim()));
await p.getByRole("button", { name: "Entrar con el código" }).click();
await p.waitForURL((u) => !/^\/entrar/.test(u.pathname), { timeout: 30000 });
await p.goto(`${BASE}/c/${ALTAMAR_ID}/consola/apariencia`);
await p.waitForLoadState("networkidle");
await p.locator(".tonos").getByRole("button", { name: "Arena" }).click();
await p.waitForTimeout(500);
const final = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--acc").trim());

// Cada cuadro desde que existe el documento: el --acc calculado y si el contenido ya se ve.
await ctx.addInitScript(() => {
  const cuadros = [];
  window.__cuadros = cuadros;
  const tomar = () => {
    const raiz = document.documentElement;
    if (raiz) cuadros.push({ t: Math.round(performance.now()), acc: getComputedStyle(raiz).getPropertyValue("--acc").trim(), pintado: Boolean(document.querySelector(".lienzo")) });
    if (performance.now() < 4000) requestAnimationFrame(tomar);
  };
  requestAnimationFrame(tomar);
});
const resultados = [];
for (let i = 0; i < 3; i++) {
  await p.goto(`${BASE}/c/${ALTAMAR_ID}/consola`);
  await p.waitForTimeout(4200);
  const cuadros = await p.evaluate(() => window.__cuadros);
  const visibles = cuadros.filter((c) => c.pintado);
  const distintos = visibles.filter((c) => c.acc !== final);
  resultados.push({ recarga: i + 1, final, primerCuadroVisible: visibles[0], cuadrosVisiblesConOtroAcento: distintos.length, ultimoConOtro: distintos.at(-1) ?? null });
}
// Cada corrida usa un contexto de navegador nuevo: la preferencia no queda guardada.
writeFileSync(salida, JSON.stringify(resultados, null, 2));
console.log(JSON.stringify(resultados, null, 2));
await nav.close();
