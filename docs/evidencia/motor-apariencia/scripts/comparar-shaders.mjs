// Compara píxel a píxel el FS completo del diseño contra el FS recortado de motor.ts.
// Uso: node comparar-shaders.mjs <shaders-completos.json> <shaders-recortados.json> [gpu]
//   completos: VS/FS del diseño (salida de generar-fs.py); recortados: VS/FS exportados de motor.ts.
import fs from 'node:fs';
import { chromium } from 'playwright';
const completo = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const recortado = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const gpu = process.argv[4] === 'gpu';
(async () => {
  const browser = await chromium.launch({ headless: true, args: gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  const r = await page.evaluate(({ completo, recortado }) => {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 400;
    const gl = cv.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const prog = (src) => { const t0 = performance.now(); const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, src.VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, src.FS)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); gl.useProgram(p); gl.getUniformLocation(p, 'uRes'); gl.drawArrays(gl.TRIANGLES, 0, 0); gl.finish(); return { p, ms: performance.now() - t0 }; };
    gl.bindVertexArray(gl.createVertexArray());
    const A = prog(completo), B = prog(recortado);
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const pals = {
      petroleoC: ['#140C0A', '#45302A', '#A88478', '#F2E6DC', '#E9DED4'],
      grafito: ['#080706', '#2C2624', '#8A7D78', '#EFE9E5', '#D5CDC8'],
      cohete: ['#64201A', '#C9402F', '#FF6252', '#FFE4DD', '#F6E6E0'],
      aluminio: ['#8F887F', '#BDB5AA', '#DCD5CB', '#FAF7F2', '#EEE9E2'],
    };
    const escenas = { bruma: 29, flujo: 32, cristal: 38, duna: 39, halo: 41, calma: 42 };
    const casos = [];
    for (const [k, tex] of Object.entries(escenas)) for (const pal of Object.keys(pals)) for (const [t, L] of [[4, [-.3, -.8]], [137.25, [.42, -.15]]]) casos.push({ k, tex, pal, t, L });
    const draw = (P, c) => {
      gl.useProgram(P.p); const u = n => gl.getUniformLocation(P.p, n);
      const col = pals[c.pal].map(hex);
      gl.viewport(0, 0, 640, 400);
      gl.uniform2f(u('uRes'), 640, 400); gl.uniform1i(u('uTex'), c.tex);
      ['uDeep', 'uBase', 'uLite', 'uHigh', 'uMetal'].forEach((n, i) => gl.uniform3fv(u(n), col[i]));
      gl.uniform2f(u('uL'), c.L[0], c.L[1]); gl.uniform1f(u('uTime'), c.t); gl.uniform1f(u('uFade'), 0); gl.uniform1f(u('uFy'), .5); gl.uniform1f(u('uGrain'), .014);
      gl.uniform3fv(u('uFadeC'), [.055, .04, .035]); gl.uniform4fv(u('uScr'), [.5, .5, 1, 1]); gl.uniform2fv(u('uScrK'), [0, 0]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(640 * 400 * 4); gl.readPixels(0, 0, 640, 400, gl.RGBA, gl.UNSIGNED_BYTE, px); return px;
    };
    const res = [];
    for (const c of casos) {
      const a = draw(A, c), b = draw(B, c); let dif = 0, max = 0, suma = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { dif++; if (d > max) max = d; } suma += a[i]; }
      res.push({ escena: c.k, tono: c.pal, t: c.t, bytesDistintos: dif, difMax: max, brilloMedio: +(suma / a.length).toFixed(1) });
    }
    return { gpuName, compilaCompletoMs: +A.ms.toFixed(1), compilaRecortadoMs: +B.ms.toFixed(1), res };
  }, { completo, recortado });
  console.log('Renderer:', r.gpuName);
  console.log('Compilar+enlazar FS completo:', r.compilaCompletoMs, 'ms | FS recortado:', r.compilaRecortadoMs, 'ms');
  let total = 0;
  for (const x of r.res) { total += x.bytesDistintos; console.log(`${x.escena.padEnd(8)} ${x.tono.padEnd(10)} t=${String(x.t).padEnd(7)} distintos=${x.bytesDistintos} difMax=${x.difMax} brillo=${x.brilloMedio}`); }
  console.log('CASOS', r.res.length, 'BYTES DISTINTOS TOTAL', total);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
