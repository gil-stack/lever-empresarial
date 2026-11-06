// Contraste de cada texto visible contra los píxeles reales que tiene detrás (escena + paneles),
// con el texto oculto al tomar la muestra. Umbral AA: 4.5, o 3 para texto grande (≥24px, o ≥18.66px y ≥600).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, SV, chromium } from "./comun.mjs";

const requerir = createRequire(`${process.cwd()}/package.json`);
const { PNG } = requerir("pngjs");
const lineal = (c) => ((c / 255) <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mezcla = (frente, fondo, a) => frente.map((v, i) => v * a + fondo[i] * (1 - a));

const [anchoArg] = process.argv.slice(2);
const ancho = Number(anchoArg ?? 1440);
const alto = ancho < 600 ? 844 : 900;
const RUTAS = (process.env.RUTAS ?? "/consola,/consola/pendientes,/consola/proveedores,/consola/personas,/consola/apariencia,/consola/configuracion").split(",");
const EMPRESA = "/c/33333333-3333-4333-8333-333333333333";
const informe = {};

for (const tema of (process.env.TEMAS ?? "oscuro,claro,lever").split(",")) {
  const nav = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, reducedMotion: "reduce", deviceScaleFactor: 1 });
  await ctx.addCookies([...(process.env.SIN_SESION ? [] : [{ name: "sesion", value: process.env.SESION ?? "a".repeat(43), url: BASE }]), { name: "tema", value: tema, url: BASE }]);
  const p = await ctx.newPage();
  const fallas = [];
  const porColor = {};
  let medidos = 0;
  let minimo = Infinity;
  for (const ruta of RUTAS) {
    await p.goto(`${BASE}${ruta.startsWith("/consola") || ruta.startsWith("/telefono") ? EMPRESA : ""}${ruta}`, { waitUntil: "networkidle" });
    await p.waitForFunction(() => ["quieto", "lento", "sin-motor"].includes(document.querySelector(".escena-fondo canvas")?.dataset.estado ?? ""), null, { timeout: 20000 }).catch(() => {});
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" + (process.env.EXTRA_CSS ?? "") });
    await p.waitForTimeout(500);
    const textos = await p.evaluate(() => {
      const salida = [];
      const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const vistos = new Set();
      while (recorrido.nextNode()) {
        const nodo = recorrido.currentNode;
        if (!nodo.textContent.trim()) continue;
        const el = nodo.parentElement;
        if (!el || vistos.has(el)) continue;
        vistos.add(el);
        if (el.closest("[aria-hidden=true], .logotipo, .solo-lector, script, style, noscript, option, [disabled], .saltar, svg, dialog:not([open])")) continue;
        const estilo = getComputedStyle(el);
        if (estilo.visibility === "hidden" || Number(estilo.opacity) === 0) continue;
        const rango = document.createRange();
        rango.selectNodeContents(nodo);
        const r = rango.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        // Opacidad acumulada de los ancestros
        let opacidad = 1;
        for (let a = el; a; a = a.parentElement) opacidad *= Number(getComputedStyle(a).opacity);
        const n = estilo.color.match(/[\d.]+/g).map(Number);
        const color = estilo.color.startsWith("color(") ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1];
        salida.push({
          texto: nodo.textContent.trim().slice(0, 40),
          clase: el.className && typeof el.className === "string" ? el.className.split(" ")[0] : el.tagName.toLowerCase(),
          color,
          opacidad,
          tamano: parseFloat(estilo.fontSize),
          peso: Number(estilo.fontWeight),
          caja: { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.width, h: r.height },
        });
      }
      return salida;
    });
    const oculto = await p.addStyleTag({ content: "html body *, html body *::before, html body *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; } svg text { fill: transparent !important; }" });
    await p.waitForTimeout(250);
    const png = PNG.sync.read(await p.screenshot());
    await oculto.evaluate((n) => n.remove());
    for (const t of textos) {
      const alfa = t.color[3] * t.opacidad;
      let peor = Infinity;
      let fondoPeor = null;
      const { x, y, w, h } = t.caja;
      for (let i = 0; i <= 6; i += 1) {
        for (let j = 0; j <= 4; j += 1) {
          const px = Math.min(png.width - 1, Math.round(x + (w * i) / 6));
          const py = Math.min(png.height - 1, Math.round(y + (h * j) / 4));
          const k = (py * png.width + px) * 4;
          const fondo = [png.data[k], png.data[k + 1], png.data[k + 2]];
          const c = contraste(mezcla(t.color.slice(0, 3), fondo, alfa), fondo);
          if (c < peor) {
            peor = c;
            fondoPeor = fondo;
          }
        }
      }
      const grande = t.tamano >= 24 || (t.tamano >= 18.66 && t.peso >= 600);
      const umbral = grande ? 3 : 4.5;
      medidos += 1;
      minimo = Math.min(minimo, peor);
      const clave = hex(t.color) + (alfa < 1 ? `@${alfa.toFixed(2)}` : "");
      const previo = porColor[clave] ?? { textos: 0, minimo: Infinity, fondo: null, ejemplo: "" };
      previo.textos += 1;
      if (peor < previo.minimo) Object.assign(previo, { minimo: Number(peor.toFixed(2)), fondo: hex(fondoPeor), ejemplo: `${ruta} «${t.texto}»` });
      porColor[clave] = previo;
      if (peor < umbral) fallas.push({ ruta, texto: t.texto, clase: t.clase, color: hex(t.color), alfa: Number(alfa.toFixed(2)), fondo: hex(fondoPeor), contraste: Number(peor.toFixed(2)), umbral, tamano: t.tamano });
    }
  }
  informe[tema] = { medidos, minimo: Number(minimo.toFixed(2)), fallas, porColor };
  console.log(`\n## ${tema} ${ancho}: ${medidos} textos, ${fallas.length} bajo AA, mínimo ${minimo.toFixed(2)}`);
  for (const f of fallas.slice(0, 40)) console.log(`  ${f.contraste} < ${f.umbral} · ${f.ruta} · «${f.texto}» .${f.clase} ${f.color}${f.alfa < 1 ? `@${f.alfa}` : ""} sobre ${f.fondo} (${f.tamano}px)`);
  await nav.close();
}
writeFileSync(`${SV}/contraste-textos-${ancho}${process.env.SUFIJO ?? (process.env.SIN_SESION ? "-publico" : "")}.json`, JSON.stringify(informe, null, 2));
