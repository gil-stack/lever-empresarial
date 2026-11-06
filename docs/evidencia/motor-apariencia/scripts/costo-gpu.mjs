// Costo real de GPU por cuadro del FS recortado: dibujo + readPixels de 1 px (obliga a esperar a la GPU).
// Uso: node costo-gpu.mjs <shaders-recortados.json> [gpu]
import fs from 'node:fs';
import { chromium } from 'playwright';
const recortado = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const gpu = process.argv[3] === 'gpu';
(async () => {
  const browser = await chromium.launch({ headless: true, args: gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  const r = await page.evaluate(({ src }) => {
    const cv = document.createElement('canvas'); cv.width = 2448; cv.height = 1530;
    const gl = cv.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, src.VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, src.FS)); gl.linkProgram(p); gl.useProgram(p);
    gl.bindVertexArray(gl.createVertexArray());
    const u = n => gl.getUniformLocation(p, n);
    const col = ['#140C0A', '#45302A', '#A88478', '#F2E6DC', '#E9DED4'].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255));
    ['uDeep', 'uBase', 'uLite', 'uHigh', 'uMetal'].forEach((n, i) => gl.uniform3fv(u(n), col[i]));
    gl.uniform1f(u('uGrain'), .014); gl.uniform1f(u('uFy'), .5); gl.uniform3fv(u('uFadeC'), [.055, .04, .035]); gl.uniform4fv(u('uScr'), [.5, .5, 1, 1]); gl.uniform2fv(u('uScrK'), [0, 0]); gl.uniform2f(u('uL'), -.3, -.8);
    const px = new Uint8Array(4); const out = {};
    for (const [w, h] of [[1224, 765], [2448, 1530], [663, 1435]]) {
      gl.viewport(0, 0, w, h); gl.uniform2f(u('uRes'), w, h);
      for (const [k, tex] of Object.entries({ bruma: 29, cristal: 38, halo: 41, calma: 42, flujo: 32, duna: 39 })) {
        gl.uniform1i(u('uTex'), tex);
        for (let i = 0; i < 5; i++) { gl.uniform1f(u('uTime'), i); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        const N = 20, t0 = performance.now();
        for (let i = 0; i < N; i++) { gl.uniform1f(u('uTime'), 10 + i * .05); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        (out[`${w}x${h}`] ||= {})[k] = +((performance.now() - t0) / N).toFixed(2);
      }
    }
    return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?', out };
  }, { src: recortado });
  console.log('Renderer:', r.renderer);
  for (const [tam, fila] of Object.entries(r.out)) console.log(tam.padEnd(10), Object.entries(fila).map(([k, v]) => `${k} ${v} ms`).join(' · '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
