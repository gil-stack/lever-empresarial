// Validación funcional del motor de escenas: clic real en cada control de /muestrario,
// capturas, reducir movimiento, comparación contra el diseño original y costo por cuadro.
// Uso (con playwright@1.64.1 instalado, dev en 4794 y el diseño servido en 4795):
//   node validar.mjs <dirEvidencia> [gpu|comparar|swiftshader]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = process.argv[2];
const MODO = process.argv[3] || 'gpu';
const APP = 'http://localhost:4794/muestrario';
const DISENO = 'http://127.0.0.1:4795/fPlat.html#apariencia';
const ESCENAS = [['bruma', 'Bruma'], ['cristal', 'Cristal'], ['halo', 'Halo'], ['calma', 'Calma'], ['flujo', 'Flujo'], ['duna', 'Duna']];
const TONOS = ['Papel Lever', 'Tinta Lever', 'Coral Lever', 'Papel blanco', 'Arena', 'Aluminio', 'Tu color'];
const log = [];
const JPG = { type: 'jpeg', quality: 85, scale: 'css' };
const anota = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };
const args = MODO !== 'swiftshader' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
fs.mkdirSync(OUT, { recursive: true });

const lienzo = (page) => page.locator('canvas.escena-lienzo');
const dato = (page, k) => lienzo(page).evaluate((c, k) => c.dataset[k], k);
const cuadros = async (page) => +(await dato(page, 'cuadros') || 0);
const esperaCuadros = async (page, n) => {
  const base = await cuadros(page);
  await page.waitForFunction(([b, n]) => +(document.querySelector('canvas.escena-lienzo')?.dataset.cuadros || 0) >= b + n, [base, n], { timeout: 20000 });
};
const panel = (page) => page.getByRole('region', { name: 'Apariencia' });
const boton = (page, nombre) => panel(page).getByRole('button', { name: nombre, exact: true });
const presionado = async (page, nombre) => (await boton(page, nombre).getAttribute('aria-pressed')) === 'true';
// Oculta el panel y el indicador de Next en desarrollo (nextjs-portal) para comparar solo el fondo.
const ocultarPanel = (page, ocultar) => page.evaluate((o) => { for (const p of document.querySelectorAll('.muestrario-escenas-panel, nextjs-portal')) p.style.visibility = o ? 'hidden' : ''; }, ocultar);
const verifica = (cond, msg) => { if (!cond) throw new Error('FALLÓ: ' + msg); anota('  ok -', msg); };

async function nuevaPagina(browser, opciones = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opciones });
  await context.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.__raf = 0;
    window.requestAnimationFrame = (cb) => { window.__raf++; return original(cb); };
  });
  const page = await context.newPage();
  const errores = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errores.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  return { context, page, errores };
}

async function abrirEscenas(page) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ver escenas' }).click();
  await page.waitForFunction(() => { const c = document.querySelector('canvas.escena-lienzo'); return c && ['vivo', 'quieto', 'lento'].includes(c.dataset.estado) && +(c.dataset.cuadros || 0) >= 1; }, null, { timeout: 30000 });
}

async function capturasPrincipales(browser, sufijo, opciones) {
  anota(`\n== Capturas principales ${sufijo} ==`);
  const { context, page, errores } = await nuevaPagina(browser, opciones);
  await abrirEscenas(page);
  const ancho = await lienzo(page).evaluate((c) => [c.width, c.height, c.offsetWidth, c.offsetHeight, devicePixelRatio]);
  anota(`  lienzo ${ancho[0]}x${ancho[1]} para ${ancho[2]}x${ancho[3]} CSS a DPR ${ancho[4]} (esperado ${Math.round(ancho[2] * Math.min(ancho[4], 2) * 0.85)} de ancho)`);
  verifica(ancho[0] === Math.round(ancho[2] * Math.min(ancho[4], 2) * 0.85), `escala 0.85 y DPR máximo 2 (${ancho[0]} px)`);
  verifica(await page.locator('.escena-fondo').getAttribute('aria-hidden') === 'true', 'el fondo es aria-hidden');
  for (const [k, n] of ESCENAS) {
    await boton(page, n).click();
    verifica(await presionado(page, n), `botón ${n} queda presionado`);
    verifica((await panel(page).locator('h2').textContent()) === n, `el panel muestra ${n}`);
    await esperaCuadros(page, 4);
    await page.screenshot({ path: path.join(OUT, `${k}-oscuro-${sufijo}.jpg`), ...JPG });
  }
  await boton(page, 'Bruma').click();
  for (const [tema, archivo] of [['Claro', 'claro'], ['Lever', 'lever']]) {
    await boton(page, tema).click();
    verifica(await presionado(page, tema), `tema ${tema} presionado`);
    verifica(await page.locator('.escena-fondo').getAttribute('data-tema') === archivo, `data-tema=${archivo} en el fondo`);
    await esperaCuadros(page, 4);
    await page.screenshot({ path: path.join(OUT, `bruma-${archivo}-${sufijo}.jpg`), ...JPG });
  }
  await boton(page, 'Oscuro').click();
  verifica(errores.length === 0, `sin errores ni avisos en consola (${errores.join(' | ') || 'ninguno'})`);
  await context.close();
}

async function recorridoDeControles(browser) {
  anota('\n== Recorrido de controles (1440x900) ==');
  const { context, page, errores } = await nuevaPagina(browser);
  await abrirEscenas(page);
  verifica(await dato(page, 'estado') === 'vivo', 'arranca vivo');
  verifica(await dato(page, 'gpu') === (MODO === 'gpu' ? 'si' : await dato(page, 'gpu')), `pinta con GPU: ${await dato(page, 'gpu')}`);
  // Tonos: cada clic presiona su botón y cambia el acento cuando corresponde.
  const acentos = {};
  for (const t of TONOS) {
    await boton(page, t).click();
    verifica(await presionado(page, t), `tono ${t} presionado`);
    acentos[t] = await page.locator('.muestrario-escenas-muestra').getAttribute('data-acento');
  }
  anota('  acentos en oscuro:', JSON.stringify(acentos));
  verifica(acentos['Arena'] === '#E9DAC5' && acentos['Tu color'] === '#A79CFF', 'acento de Arena y Tu color como en el diseño');
  const color = panel(page).locator('input[type=color]');
  await color.fill('#3cc48f');
  await esperaCuadros(page, 3);
  verifica(await page.locator('.muestrario-escenas-muestra').getAttribute('data-acento') === '#5fcfa3', 'Tu color #3CC48F da acento #5fcfa3 (mkPal)');
  await page.screenshot({ path: path.join(OUT, 'bruma-tu-color-1440.jpg'), ...JPG });
  await boton(page, 'Claro').click();
  const acentoClaro = await page.locator('.muestrario-escenas-muestra').getAttribute('data-acento');
  const lumClaro = await page.evaluate((h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }, acentoClaro);
  verifica(acentoClaro !== '#5fcfa3' && lumClaro <= 0.18, `en Claro el acento de Tu color se oscurece para contrastar (${acentoClaro}, luminancia ${lumClaro.toFixed(3)})`);
  await boton(page, 'Oscuro').click();
  await boton(page, 'Papel Lever').click();
  // Movimiento apagado: un cuadro quieto y nada de rAF.
  const mov = panel(page).getByLabel('Fondo animado');
  await mov.uncheck();
  await page.waitForFunction(() => document.querySelector('canvas.escena-lienzo')?.dataset.estado === 'quieto');
  let c0 = await cuadros(page), r0 = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(2000);
  let c1 = await cuadros(page), r1 = await page.evaluate(() => window.__raf);
  verifica(c0 === 1, `al apagar «Fondo animado» pinta un solo cuadro quieto (${c0})`);
  verifica(c1 === c0 && r1 - r0 === 0, `con «Fondo animado» apagado los cuadros no avanzan en 2 s (${c0} → ${c1}); rAF de la página +${r1 - r0}`);
  await boton(page, 'Halo').click();
  await page.waitForTimeout(300);
  verifica(await cuadros(page) === c1 + 1, 'quieto, cambiar de escena pinta exactamente un cuadro');
  await mov.check();
  await page.waitForFunction(() => document.querySelector('canvas.escena-lienzo')?.dataset.estado === 'vivo');
  await esperaCuadros(page, 5);
  verifica(true, 'al encenderlo vuelve a vivo y avanza');
  // Luz que sigue al cursor.
  const luz = panel(page).getByLabel('La luz sigue al cursor');
  await luz.uncheck();
  verifica(!(await luz.isChecked()), 'luz dinámica apagada');
  await luz.check();
  await page.mouse.move(1300, 100);
  await esperaCuadros(page, 3);
  verifica(await luz.isChecked(), 'luz dinámica encendida y el cursor se mueve sin errores');
  // Persistencia por navegador.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ver escenas' }).click();
  verifica(await presionado(page, 'Halo') && await presionado(page, 'Oscuro') && await presionado(page, 'Papel Lever'), 'tras recargar se recupera Halo, Oscuro y Papel Lever');
  const guardado = await page.evaluate(() => localStorage.getItem('lever-apariencia-v1'));
  anota('  localStorage:', guardado);
  // Pausa cuando la pestaña se oculta.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  verifica(await dato(page, 'estado') === 'pausa', 'pestaña oculta → pausa');
  c0 = await cuadros(page); await page.waitForTimeout(1000); c1 = await cuadros(page);
  verifica(c0 === c1, `en pausa no pinta (${c0} → ${c1})`);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await esperaCuadros(page, 3);
  verifica(await dato(page, 'estado') === 'vivo', 'pestaña visible → vivo otra vez');
  // Cerrar desmonta y deja de pedir cuadros.
  await panel(page).getByRole('button', { name: 'Cerrar' }).click();
  verifica(await page.locator('canvas.escena-lienzo').count() === 0, 'Cerrar quita el lienzo');
  await page.waitForTimeout(300);
  r0 = await page.evaluate(() => window.__raf); await page.waitForTimeout(1500); r1 = await page.evaluate(() => window.__raf);
  verifica(r1 - r0 === 0, `tras cerrar no queda rAF corriendo (+${r1 - r0} en 1.5 s)`);
  verifica(errores.length === 0, `sin errores ni avisos en consola (${errores.join(' | ') || 'ninguno'})`);
  await context.close();
}

async function reducirMovimiento(browser) {
  anota('\n== prefers-reduced-motion: reduce ==');
  const { context, page, errores } = await nuevaPagina(browser, { reducedMotion: 'reduce' });
  await abrirEscenas(page);
  verifica(await dato(page, 'estado') === 'quieto', 'con reducir movimiento arranca quieto');
  await page.waitForTimeout(500);
  const c0 = await cuadros(page), r0 = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(2000);
  const c1 = await cuadros(page), r1 = await page.evaluate(() => window.__raf);
  verifica(c0 === 1, `pinta un solo cuadro quieto (${c0})`);
  verifica(c0 === c1, `los cuadros no avanzan en 2 s (${c0} → ${c1})`);
  verifica(r1 - r0 === 0, `ningún requestAnimationFrame en 2 s (+${r1 - r0})`);
  verifica(await panel(page).getByLabel('Fondo animado').isChecked(), '«Fondo animado» sigue encendido: manda el sistema');
  await page.screenshot({ path: path.join(OUT, 'reducir-movimiento-1440.jpg'), ...JPG });
  await boton(page, 'Duna').click();
  await page.waitForTimeout(300);
  verifica(await cuadros(page) === c1 + 1, 'cambiar de escena pinta un solo cuadro quieto');
  verifica(errores.length === 0, `sin errores ni avisos en consola (${errores.join(' | ') || 'ninguno'})`);
  await context.close();
}

async function comparar(page, a, b) {
  const da = 'data:image/png;base64,' + fs.readFileSync(a).toString('base64');
  const db = 'data:image/png;base64,' + fs.readFileSync(b).toString('base64');
  return page.evaluate(async ([da, db]) => {
    const carga = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([carga(da), carga(db)]);
    const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const pa = px(ia), pb = px(ib); let suma = 0, mayores = 0, max = 0;
    for (let i = 0; i < pa.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) { const d = Math.abs(pa[i + k] - pb[i + k]); suma += d; if (d > m) m = d; } if (m > 8) mayores++; if (m > max) max = m; }
    const n = pa.length / 4;
    return { mediaAbs: +(suma / (n * 3)).toFixed(3), pctMas8: +(100 * mayores / n).toFixed(3), max };
  }, [da, db]);
}

async function contraDiseno(browser) {
  anota('\n== Comparación contra el diseño original (quieto, 1440x900) ==');
  const app = await nuevaPagina(browser);
  await abrirEscenas(app.page);
  await panel(app.page).getByLabel('Fondo animado').uncheck();
  const dis = await nuevaPagina(browser);
  await dis.page.goto(DISENO, { waitUntil: 'load' });
  await dis.page.waitForSelector('[data-act=scene][data-k=bruma]');
  // Apagar animación y luz con cursor desde su panel de Apariencia.
  for (const act of ['apMot', 'apDyn']) {
    const sw = dis.page.locator(`[data-act=${act}]`);
    if ((await sw.getAttribute('aria-checked')) === 'true') await sw.dispatchEvent('click');
    verifica((await sw.getAttribute('aria-checked')) === 'false', `diseño: ${act} apagado desde su panel`);
  }
  const casos = [...ESCENAS.map(([k, n]) => ({ k, n, tema: 'oscuro', temaDis: 'oscuro', temaApp: 'Oscuro', base: k })),
    { k: 'bruma', n: 'Bruma', tema: 'claro', temaDis: 'claro', temaApp: 'Claro', base: 'bruma-claro' },
    { k: 'bruma', n: 'Bruma', tema: 'lever', temaDis: 'cohete', temaApp: 'Lever', base: 'bruma-lever' }];
  const tabla = [];
  for (const c of casos) {
    await dis.page.locator(`[data-act=theme][data-k=${c.temaDis}]`).dispatchEvent('click');
    await dis.page.locator(`[data-act=scene][data-k=${c.k}]`).dispatchEvent('click');
    await dis.page.waitForTimeout(1500);
    await dis.page.addStyleTag({ content: 'body>*:not(.stageBg){visibility:hidden!important}' }).then((h) => h.evaluate((s) => s.setAttribute('data-ocultar', '')));
    await dis.page.waitForTimeout(200);
    const fDis = path.join(OUT, `${c.base}-diseno.png`);
    await dis.page.screenshot({ path: fDis });
    await dis.page.evaluate(() => document.querySelectorAll('style[data-ocultar]').forEach((s) => s.remove()));
    await boton(app.page, c.temaApp).click();
    await boton(app.page, c.n).click();
    await app.page.waitForTimeout(400);
    await ocultarPanel(app.page, true);
    const fApp = path.join(OUT, `${c.base}-app.png`);
    await app.page.screenshot({ path: fApp });
    await ocultarPanel(app.page, false);
    const d = await comparar(app.page, fDis, fApp);
    tabla.push({ caso: c.base, ...d });
    // Se guarda a 960 px de ancho para no cargar el repositorio; la diferencia se midió a tamaño real.
    for (const f of [fDis, fApp]) execFileSync('sips', ['-Z', '960', f], { stdio: 'ignore' });
    anota(`  ${c.base.padEnd(12)} diferencia media ${d.mediaAbs}/255 · píxeles con >8 niveles ${d.pctMas8}% · máx ${d.max}`);
  }
  // Una del diseño con su interfaz encima, como referencia de cómo se ve en uso.
  await dis.page.locator('[data-act=theme][data-k=oscuro]').dispatchEvent('click');
  await dis.page.locator('[data-act=scene][data-k=bruma]').dispatchEvent('click');
  await dis.page.waitForTimeout(800);
  await dis.page.screenshot({ path: path.join(OUT, 'bruma-diseno-con-interfaz.jpg'), ...JPG });
  verifica(app.errores.length === 0, `app sin errores ni avisos en consola (${app.errores.join(' | ') || 'ninguno'})`);
  anota('  avisos del diseño original (no son nuestros):', dis.errores.length);
  await app.context.close(); await dis.context.close();
  return tabla;
}

async function costo(browser, dpr) {
  anota(`\n== Costo por cuadro (${MODO}, 1440x900, DPR ${dpr}) ==`);
  const { context, page, errores } = await nuevaPagina(browser, { deviceScaleFactor: dpr });
  await abrirEscenas(page);
  const renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'sin WebGL2'; });
  anota('  renderer:', renderer);
  const filas = [];
  for (const [k, n] of ESCENAS) {
    await boton(page, n).click();
    await esperaCuadros(page, 3);
    if (await dato(page, 'estado') !== 'vivo') { filas.push({ escena: k, estado: await dato(page, 'estado') }); anota(`  ${k}: estado ${await dato(page, 'estado')}`); continue; }
    const a = await lienzo(page).evaluate((c) => ({ n: +c.dataset.cuadros, ms: +c.dataset.ms, t: performance.now(), raf: window.__raf }));
    await page.waitForTimeout(3000);
    const b = await lienzo(page).evaluate((c) => ({ n: +c.dataset.cuadros, ms: +c.dataset.ms, t: performance.now(), raf: window.__raf, estado: c.dataset.estado, w: c.width, h: c.height }));
    const dibujados = b.n - a.n;
    const msPorCuadro = dibujados ? (b.ms * b.n - a.ms * a.n) / dibujados : NaN;
    const fps = (b.raf - a.raf) / ((b.t - a.t) / 1000);
    filas.push({ escena: k, lienzo: `${b.w}x${b.h}`, msPorCuadro: +msPorCuadro.toFixed(2), dibujosPorSeg: +(dibujados / ((b.t - a.t) / 1000)).toFixed(1), rafPorSeg: +fps.toFixed(1), estado: b.estado });
    anota(`  ${k.padEnd(8)} lienzo ${b.w}x${b.h} · ${msPorCuadro.toFixed(2)} ms por dibujo · ${(dibujados / ((b.t - a.t) / 1000)).toFixed(1)} dibujos/s · rAF ${fps.toFixed(1)}/s · ${b.estado}`);
  }
  await page.waitForTimeout(500);
  const estadoFinal = await dato(page, 'estado');
  anota('  estado al final:', estadoFinal);
  verifica(errores.length === 0, `sin errores ni avisos en consola (${errores.join(' | ') || 'ninguno'})`);
  await context.close();
  return { renderer, filas, estadoFinal };
}

async function equipoLento(browser) {
  anota('\n== Equipo lento (SwiftShader, sin GPU, 1440x900 DPR 1) ==');
  const { context, page, errores } = await nuevaPagina(browser);
  await abrirEscenas(page);
  const renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'sin WebGL2'; });
  anota('  renderer:', renderer);
  verifica(await dato(page, 'estado') === 'vivo', 'arranca vivo');
  const t0 = Date.now();
  await page.waitForFunction(() => document.querySelector('canvas.escena-lienzo')?.dataset.estado === 'lento', null, { timeout: 20000 });
  anota(`  pasó a lento en ${((Date.now() - t0) / 1000).toFixed(1)} s · ms medio por dibujo hasta ahí ${await dato(page, 'ms')} · cuadros ${await dato(page, 'cuadros')}`);
  const c0 = await cuadros(page), r0 = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(2000);
  const c1 = await cuadros(page), r1 = await page.evaluate(() => window.__raf);
  verifica(c0 === c1 && r1 - r0 === 0, `quieto por lento: cuadros ${c0} → ${c1}, rAF +${r1 - r0} en 2 s`);
  await page.screenshot({ path: path.join(OUT, 'equipo-lento-1440.jpg'), ...JPG });
  await boton(page, 'Halo').click();
  await page.waitForTimeout(300);
  verifica(await cuadros(page) === c1 + 1, 'cambiar de escena con equipo lento pinta un solo cuadro quieto');
  // El único aviso esperado es el de Chrome al copiar WebGL a un canvas 2D sin aceleración.
  const ajenos = errores.filter((e) => !e.includes('GPU stall due to ReadPixels'));
  anota(`  avisos de Chrome por lectura de píxeles sin GPU: ${errores.length - ajenos.length}`);
  verifica(ajenos.length === 0, `sin otros errores ni avisos (${ajenos.join(' | ') || 'ninguno'})`);
  await context.close();
  return { renderer };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args });
  const resultado = { modo: MODO };
  try {
    if (MODO === 'comparar') {
      resultado.comparacion = await contraDiseno(browser);
    } else if (MODO === 'gpu') {
      await capturasPrincipales(browser, '1440', {});
      await capturasPrincipales(browser, '390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await recorridoDeControles(browser);
      await reducirMovimiento(browser);
      resultado.comparacion = await contraDiseno(browser);
      resultado.costoDpr1 = await costo(browser, 1);
      resultado.costoDpr2 = await costo(browser, 2);
    } else {
      resultado.lento = await equipoLento(browser);
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, `resultado-${MODO}.json`), JSON.stringify(resultado, null, 2));
    fs.writeFileSync(path.join(OUT, `registro-${MODO}.txt`), log.join('\n') + '\n');
  }
})().catch((e) => { console.error(e); process.exit(1); });
