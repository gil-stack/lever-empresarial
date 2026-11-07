// Recorrido funcional de «Evita que el tope de intentos revele qué correos tienen cuenta»,
// con Playwright headless contra `next start` y un Postgres local desechable.
//
//   BASE=http://localhost:4805 \
//   DUENO_URL=postgres://dueno@127.0.0.1:5531/plataforma \
//   node scripts/evidencia/enumeracion-tope.mjs
//
// En /entrar y en /operacion/entrar: diez contraseñas malas con un correo que
// tiene cuenta y diez con uno que no, y un undécimo intento con la contraseña
// correcta. El tope es de 8 fallos en 15 minutos, así que del noveno en
// adelante la cuenta real está bloqueada. Cada respuesta se captura y se
// compara con la del correo sin cuenta: texto, marcado del aviso, dirección y
// tiempo. Todo pasa por clics; la base solo se lee. Rechaza un DUENO_URL que
// no sea local.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://localhost:4805";
const DUENO = process.env.DUENO_URL ?? "";
const SALIDA = process.env.SALIDA ?? "docs/evidencia/enumeracion-tope";
const CLAVE = process.env.CLAVE ?? "clave-segura-12";
const MALA = "otra-clave-99";
const INTENTOS = 10;
const PISO_MS = 1_500;

if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) {
  throw new Error("DUENO_URL tiene que apuntar a un Postgres local desechable (127.0.0.1 o localhost).");
}

const requerir = createRequire(import.meta.url);
const { chromium } = requerir("playwright");
mkdirSync(SALIDA, { recursive: true });

const lineas = [];
function anotar(texto) {
  console.log(texto);
  lineas.push(texto);
}
function exigir(condicion, texto) {
  if (!condicion) throw new Error(`FALLO ${texto}`);
  anotar(`OK ${texto}`);
}
function sql(consulta) {
  return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}
function idDe(correo) {
  return sql(`select id from users where correo = '${correo}'`);
}
function fallosDe(userId) {
  return Number(sql(`select count(*) from audit_log where accion = 'entrada_fallida' and identificador = '${userId}'`));
}
function entradasDe(userId) {
  return Number(sql(`select count(*) from auth_entradas where user_id = '${userId}'`));
}

const SUPERFICIES = [
  { nombre: "cliente", ruta: "/entrar", real: "laura@demo.test", inexistente: "nadie@demo.test" },
  { nombre: "operacion", ruta: "/operacion/entrar", real: "op@lever.test", inexistente: "nadie@lever.test" },
];

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const pagina = await contexto.newPage();
const erroresDeConsola = [];
pagina.on("console", (m) => {
  if (m.type() === "error") erroresDeConsola.push(m.text());
});
pagina.on("pageerror", (e) => erroresDeConsola.push(e.message));

/**
 * Un intento clicado: abre la entrada limpia, escribe, oprime Continuar y espera el aviso.
 * Mide dos tiempos: el del servidor (envío del formulario al primer byte de la
 * respuesta, que sale cuando la acción terminó; sin el pintado del navegador
 * ni el resto del flujo RSC) y el visible (clic a aviso en pantalla).
 */
async function intentar(superficie, correo, contrasena, archivo) {
  await pagina.goto(`${BASE}${superficie.ruta}`);
  // El aviso de la entrada; Next agrega su propio role="alert" para anunciar rutas.
  const aviso = pagina.locator('.alerta[role="alert"]');
  if ((await aviso.count()) > 0) throw new Error(`FALLO ${superficie.ruta} ya mostraba un aviso antes de enviar`);
  await pagina.getByLabel("Correo").fill(correo);
  await pagina.getByLabel("Contraseña", { exact: true }).fill(contrasena);
  const envio = pagina.waitForResponse((r) => r.request().method() === "POST", { timeout: 15_000 });
  const inicio = Date.now();
  await pagina.getByRole("button", { name: "Continuar" }).click();
  const respuesta = await envio;
  await aviso.first().waitFor({ state: "visible", timeout: 15_000 });
  const ms = Date.now() - inicio;
  const t = respuesta.request().timing();
  const servidor = Math.round(t.responseStart - t.requestStart);
  // La tarjeta de la entrada, en JPEG: 44 capturas a pantalla completa pesaban 41 MB.
  await pagina.locator(".arco-acceso-tarjeta").screenshot({ path: `${SALIDA}/${archivo}.jpg`, type: "jpeg", quality: 82 });
  const texto = (await aviso.first().innerText()).replace(/\s+/g, " ").trim();
  const marcado = await aviso.first().evaluate((n) => n.outerHTML);
  const direccion = new URL(pagina.url()).pathname + new URL(pagina.url()).search;
  return { ms, servidor, texto, marcado, direccion };
}

const resumen = [];
for (const superficie of SUPERFICIES) {
  const userId = idDe(superficie.real);
  exigir(userId.length === 36, `${superficie.nombre}: ${superficie.real} tiene cuenta y ${superficie.inexistente} no`);
  exigir(idDe(superficie.inexistente) === "", `${superficie.nombre}: ${superficie.inexistente} no existe en la base`);
  const fallosAntes = fallosDe(userId);
  const entradasAntes = entradasDe(userId);
  exigir(fallosAntes === 0, `${superficie.nombre}: ${superficie.real} empieza sin fallos`);

  for (let i = 1; i <= INTENTOS + 1; i += 1) {
    const contrasena = i <= INTENTOS ? MALA : CLAVE;
    const tipo = i <= INTENTOS ? "contraseña mala" : "contraseña CORRECTA";
    const n = String(i).padStart(2, "0");
    // Se alterna quién va primero para que el orden no sesgue el tiempo en pantalla.
    const conCuenta = () => intentar(superficie, superficie.real, contrasena, `${superficie.nombre}-real-${n}`);
    const sinCuenta = () => intentar(superficie, superficie.inexistente, contrasena, `${superficie.nombre}-inexistente-${n}`);
    let real;
    let nadie;
    if (i % 2 === 1) {
      real = await conCuenta();
      nadie = await sinCuenta();
    } else {
      nadie = await sinCuenta();
      real = await conCuenta();
    }
    const tope = i > 8 ? " [cuenta real en el tope]" : "";
    anotar(
      `${superficie.nombre} intento ${n} (${tipo})${tope}: ` +
        `real servidor ${real.servidor} ms (pantalla ${real.ms}) «${real.texto}» ${real.direccion} | ` +
        `inexistente servidor ${nadie.servidor} ms (pantalla ${nadie.ms}) «${nadie.texto}» ${nadie.direccion}`,
    );
    exigir(real.texto === nadie.texto, `${superficie.nombre} intento ${n}: mismo texto`);
    exigir(real.marcado === nadie.marcado, `${superficie.nombre} intento ${n}: mismo marcado del aviso`);
    exigir(real.direccion === nadie.direccion, `${superficie.nombre} intento ${n}: misma dirección`);
    exigir(real.servidor >= PISO_MS && nadie.servidor >= PISO_MS, `${superficie.nombre} intento ${n}: el servidor tarda al menos ${PISO_MS} ms en los dos`);
    const diferencia = Math.abs(real.servidor - nadie.servidor);
    exigir(diferencia <= 100, `${superficie.nombre} intento ${n}: diferencia de ${diferencia} ms en el servidor (≤ 100)`);
    resumen.push({
      superficie: superficie.nombre,
      intento: i,
      contrasena: tipo,
      servidor: { real: real.servidor, inexistente: nadie.servidor },
      pantalla: { real: real.ms, inexistente: nadie.ms },
      texto: real.texto,
    });
  }

  exigir(
    resumen.filter((r) => r.superficie === superficie.nombre).every((r) => r.texto.includes("Si fallaste varias veces, espera quince minutos.")),
    `${superficie.nombre}: las 22 respuestas usan el mismo texto único`,
  );
  const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const propias = resumen.filter((r) => r.superficie === superficie.nombre);
  const enServidor = { real: mediana(propias.map((r) => r.servidor.real)), inexistente: mediana(propias.map((r) => r.servidor.inexistente)) };
  exigir(
    Math.abs(enServidor.real - enServidor.inexistente) <= 20,
    `${superficie.nombre}: mediana en el servidor ${enServidor.real} ms con cuenta y ${enServidor.inexistente} ms sin cuenta (≤ 20 de diferencia)`,
  );
  // Informativo: el tiempo en pantalla suma el pintado del navegador, que no depende de la cuenta
  // (la respuesta del servidor ya es igual en texto, marcado y tiempo).
  const enPantalla = { real: mediana(propias.map((r) => r.pantalla.real)), inexistente: mediana(propias.map((r) => r.pantalla.inexistente)) };
  anotar(`${superficie.nombre}: mediana en pantalla ${enPantalla.real} ms con cuenta y ${enPantalla.inexistente} ms sin cuenta (informativo)`);
  exigir(fallosDe(userId) === fallosAntes + 8, `${superficie.nombre}: la bitácora anota 8 fallos; los intentos 9, 10 y 11 (en el tope) no se anotan`);
  exigir(entradasDe(userId) === entradasAntes, `${superficie.nombre}: la contraseña correcta en el tope no abrió entrada`);
}

// Control: una cuenta sin fallos entra con su contraseña y no espera el piso.
await pagina.goto(`${BASE}/operacion/entrar`);
await pagina.getByLabel("Correo").fill("op2@lever.test");
await pagina.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
const inicioControl = Date.now();
await pagina.getByRole("button", { name: "Continuar" }).click();
await pagina.waitForURL(/\/operacion\/continuar/, { timeout: 15_000 });
const msControl = Date.now() - inicioControl;
await pagina.locator(".arco-acceso-tarjeta").screenshot({ path: `${SALIDA}/control-op2-entra.jpg`, type: "jpeg", quality: 82 });
exigir(msControl < PISO_MS, `control: op2@lever.test con su contraseña llega a /operacion/continuar en ${msControl} ms, sin el piso`);

// Lado a lado del intento 9 y del 11, donde antes la cuenta real respondía distinto.
const lamina = await contexto.newPage();
for (const superficie of SUPERFICIES) {
  for (const n of ["09", "11"]) {
    const img = (lado) => readFileSync(`${SALIDA}/${superficie.nombre}-${lado}-${n}.jpg`).toString("base64");
    await lamina.setViewportSize({ width: 1000, height: 400 });
    await lamina.setContent(`<!doctype html><meta charset="utf-8"><style>
      body{margin:0;font:14px system-ui;background:#111;color:#eee;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}
      figure{margin:0}figcaption{padding:4px 0 6px}img{width:100%;display:block;border:1px solid #444}
    </style>
    <figure><figcaption>${superficie.ruta} · intento ${n} · correo CON cuenta (${superficie.real})</figcaption><img src="data:image/jpeg;base64,${img("real")}"></figure>
    <figure><figcaption>${superficie.ruta} · intento ${n} · correo SIN cuenta (${superficie.inexistente})</figcaption><img src="data:image/jpeg;base64,${img("inexistente")}"></figure>`);
    await lamina.screenshot({ path: `${SALIDA}/lado-a-lado-${superficie.nombre}-${n}.png`, fullPage: true });
  }
}

exigir(erroresDeConsola.length === 0, `sin errores de consola (${erroresDeConsola.length})`);
await navegador.close();

writeFileSync(`${SALIDA}/tiempos.json`, `${JSON.stringify(resumen, null, 2)}\n`);
writeFileSync(`${SALIDA}/recorrido.txt`, `${lineas.join("\n")}\n`);
console.log(`\n${lineas.filter((l) => l.startsWith("OK ")).length} comprobaciones OK`);
