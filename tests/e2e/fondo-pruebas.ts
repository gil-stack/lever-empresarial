import { expect, test, type Browser, type LaunchOptions, type Page, type PlaywrightWorkerArgs } from "@playwright/test";

import { INICIO, entrar } from "./marco-apoyo";

/** Lo que este archivo necesita de un Long Animation Frame (el DOM de TypeScript aún no lo trae). */
interface CuadroLargo {
  startTime: number;
  duration: number;
  renderStart: number;
  scripts: { sourceURL: string; duration: number; invoker: string }[];
}

/**
 * Lo que el propio fondo puede tardar en un cuadro antes de contar como suyo: DIBUJO_BLOQUEANTE_MS de fondo-escena.tsx
 * (con GPU, el dibujo más caro medido es de 12 ms; con el pintado encima, uno de ~32 ms ya deja un cuadro de más de 50).
 */
const MS_DEL_FONDO_POR_CUADRO = 25;

/**
 * Los cuadros de más de 50 ms (Long Animation Frames) después de la primera pintura del fondo en los que el fondo mismo
 * tardó más de MS_DEL_FONDO_POR_CUADRO. El fondo anima en cada cuadro, así que su callback está en casi todos: un cuadro
 * largo por otro script de la página o por el pintado (en el CI, con la CPU compartida) no es suyo.
 * Medido con el navegador frenado ×16 y ×24 por CDP (docs/evidencia/pld-fechas/fondo/): en esos cuadros, de 53 a 137 ms,
 * el script del fondo pone de 5 a 12 ms y el resto son otros scripts de la página (el streaming de React) y su espera. `detalle` dice, de cada cuadro largo con algo del fondo, cuánto duró, cuánto
 * fue del fondo y cuánto de pintado, para leer una falla.
 */
async function cuadrosLargosDelFondo(page: Page): Promise<{ archivos: number; cuadros: number; detalle: string }> {
  return page.evaluate(async (limite) => {
    const registro = window as unknown as { cuadrosLargos: CuadroLargo[]; primeraPintura?: number };
    // El archivo del bucle del fondo es el que trae su aviso de error.
    const delFondo = new Set<string>();
    for (const recurso of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
      if (recurso.initiatorType !== "script") continue;
      if ((await (await fetch(recurso.name)).text()).includes("No se pudo cargar el fondo animado")) delFondo.add(recurso.name);
    }
    const primera = registro.primeraPintura ?? Infinity;
    const conFondo = registro.cuadrosLargos
      .filter((cuadro) => cuadro.startTime > primera)
      .map((cuadro) => ({
        cuadro,
        fondoMs: cuadro.scripts.filter((script) => delFondo.has(script.sourceURL)).reduce((suma, script) => suma + script.duration, 0),
      }))
      .filter(({ cuadro }) => cuadro.scripts.some((script) => delFondo.has(script.sourceURL)));
    const detalle = conFondo
      .map(({ cuadro, fondoMs }) => `${Math.round(cuadro.duration)} ms (fondo ${Math.round(fondoMs)}, pintado ${cuadro.renderStart ? Math.round(cuadro.startTime + cuadro.duration - cuadro.renderStart) : "?"})`)
      .join("; ");
    return { archivos: delFondo.size, cuadros: conFondo.filter(({ fondoMs }) => fondoMs > limite).length, detalle };
  }, MS_DEL_FONDO_POR_CUADRO);
}

/**
 * Un equipo emulado igual en cualquier máquina: el lienzo mide `--lado` (48 px), así que pintarlo de verdad no cuesta
 * nada, y cada dibujo tarda `dibujoMs`; si además crece el búfer del motor (el lienzo del que se copia la escena), tarda
 * `crecerMs` más. En headless, la copia desde WebGL espera a SwiftShader, a veces más de 25 ms
 * (docs/evidencia/ola-2b-navegacion/datos/n7-ruido-swiftshader.txt), y agrandar el búfer de WebGL cuesta de 20 a 50 ms:
 * la escena no se copia y los escenarios no pasan de 48 px, salvo el que hace crecer el búfer. Así el costo es solo el
 * emulado. Registra los cuadros largos y la primera pintura del fondo.
 */
async function emularEquipo(page: Page, costo: { dibujoMs: number; crecerMs: number }) {
  await page.addInitScript((op) => {
    const registro = window as unknown as { cuadrosLargos: unknown[]; primeraPintura?: number };
    registro.cuadrosLargos = [];
    new PerformanceObserver((lista) => registro.cuadrosLargos.push(...lista.getEntries())).observe({ type: "long-animation-frame", buffered: true });
    new MutationObserver(() => {
      if (registro.primeraPintura === undefined && document.querySelector("canvas.escena-lienzo[data-cuadros]")) registro.primeraPintura = performance.now();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-cuadros"] });
    const copiar = CanvasRenderingContext2D.prototype.drawImage;
    const maximos = new WeakMap<object, [number, number]>();
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...argumentos: unknown[]) {
      if (this.canvas.classList.contains("escena-lienzo")) {
        const bufer = argumentos[0] as HTMLCanvasElement;
        const antes = maximos.get(bufer);
        const crece = antes !== undefined && (bufer.width > antes[0] || bufer.height > antes[1]);
        maximos.set(bufer, [Math.max(bufer.width, antes?.[0] ?? 0), Math.max(bufer.height, antes?.[1] ?? 0)]);
        const hasta = performance.now() + op.dibujoMs + (crece ? op.crecerMs : 0);
        while (performance.now() < hasta);
        return;
      }
      return (copiar as (...a: unknown[]) => void).apply(this, argumentos);
    } as typeof copiar;
    document.addEventListener("DOMContentLoaded", () => {
      const estilo = document.createElement("style");
      estilo.textContent = ".escena-lienzo { width: var(--lado, 48px) !important; height: var(--lado, 48px) !important; }";
      // Con la CSP estricta (style-src con nonce, desde el #62), una hoja sin el nonce de la página no se aplica y el lienzo
      // queda a pantalla completa: la emulación deja de serlo y el fondo pinta 1440×900 (2880×1800 a DPR 2) con WebGL.
      estilo.nonce = document.querySelector<HTMLElement>("[nonce]")?.nonce ?? "";
      document.head.append(estilo);
    });
  }, costo);
}

/** El lado del lienzo cambia cada `cadaMs` (o en cada cuadro) por los valores dados; regresa al terminar. */
function cambiarLado(page: Page, lados: number[], cadaMs: number | "cuadro") {
  return page.evaluate(
    ({ lados, cadaMs }) =>
      new Promise<void>((listo) => {
        // En el lienzo y no en la raíz: así el cambio no recalcula el estilo de toda la página en cada cuadro.
        const lienzo = document.querySelector<HTMLElement>("canvas.escena-lienzo")!;
        let i = 0;
        const paso = () => {
          if (i >= lados.length) return listo();
          lienzo.style.setProperty("--lado", `${lados[i++]}px`);
          if (cadaMs === "cuadro") requestAnimationFrame(paso);
          else setTimeout(paso, cadaMs);
        };
        paso();
      }),
    { lados, cadaMs },
  );
}

interface Escenario {
  nombre: string;
  /** Lo que pasa después de la primera pintura. */
  hacer: (page: Page) => Promise<void>;
  /** Costo extra emulado cuando crece el búfer del motor. */
  crecerMs?: number;
  /** Sin GPU: cuadros largos del fondo y pinturas que se aceptan después de la primera. */
  sinGpu: { largos: number; pinturas: number };
  /** Con GPU: cuadros largos del fondo que se aceptan (el dibujo que agranda el búfer tarda lo que tarda). */
  conGpuLargos?: number;
}

const ESCENARIOS: Escenario[] = [
  { nombre: "estable", hacer: async (page) => page.waitForTimeout(2500), sinGpu: { largos: 1, pinturas: 2 } },
  {
    // Lo que tapaba la excepción de tamaño: cada dibujo con otro tamaño, sin que crezca el búfer.
    nombre: "el lienzo cambia de tamaño en cada cuadro",
    hacer: async (page) => {
      await cambiarLado(page, Array.from({ length: 151 }, (_, i) => (i % 2 ? 48 : 44)), "cuadro");
      await page.waitForTimeout(700);
    },
    sinGpu: { largos: 2, pinturas: 3 },
  },
  {
    // Con GPU, crecer a 2560×1600 a DPR 2 tomó 30 ms: aquí, 40 ms en el dibujo que agranda el búfer. Crece con el fondo
    // ya animando (o ya quieto): el primer dibujo crea el búfer, así que el segundo siempre se mide aunque lo agrande.
    nombre: "el búfer del motor crece una vez",
    crecerMs: 40,
    hacer: async (page) => {
      await page.waitForFunction(() => {
        const lienzo = document.querySelector("canvas.escena-lienzo");
        return lienzo?.getAttribute("data-estado") === "lento" || Number(lienzo?.getAttribute("data-cuadros")) >= 3;
      });
      await cambiarLado(page, [64], 0);
      await page.waitForTimeout(1500);
    },
    sinGpu: { largos: 2, pinturas: 3 },
    conGpuLargos: 1,
  },
  {
    // Otra tarea de la página (una captura grande, o la laptop que se duerme): un hueco de 800 ms entre cuadros.
    nombre: "una tarea ajena de 800 ms",
    hacer: async (page) => {
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const hasta = performance.now() + 800;
        while (performance.now() < hasta);
      });
      // Dos ventanas de 60 cuadros: la que tiene el hueco ya se evaluó.
      await page.waitForTimeout(2500);
    },
    sinGpu: { largos: 1, pinturas: 2 },
  },
  {
    // Arrastrar la ventana: el lienzo encoge y vuelve a crecer, sin pasar de su tamaño inicial, 36 veces en 1.1 s.
    nombre: "arrastrar la ventana",
    hacer: async (page) => {
      await cambiarLado(page, Array.from({ length: 36 }, (_, i) => (i <= 20 ? 48 - 2 * i : 8 + 2 * (i - 20))), 30);
      await page.waitForTimeout(700);
    },
    sinGpu: { largos: 2, pinturas: 3 },
  },
];

/** Un navegador solo para una prueba: en el CI, otra conexión al servidor de navegadores (otro proceso); en local, otro lanzamiento. */
async function navegadorPropio(playwright: PlaywrightWorkerArgs["playwright"], launchOptions: LaunchOptions): Promise<Browser> {
  const remoto = process.env.PW_TEST_CONNECT_WS_ENDPOINT;
  if (!remoto) return playwright.chromium.launch(launchOptions);
  const headers = process.env.PW_TEST_CONNECT_HEADERS ? (JSON.parse(process.env.PW_TEST_CONNECT_HEADERS) as Record<string, string>) : undefined;
  return playwright.chromium.connect(remoto, { headers, exposeNetwork: process.env.PW_TEST_CONNECT_EXPOSE_NETWORK });
}

const EQUIPOS = [["sin GPU", false], ["con GPU rápida", true]] as const;

/**
 * Qué pruebas del fondo define cada llamada y en qué orden: el reparto de la e2e corta por número de pruebas, en orden, y los
 * cuatro archivos del fondo eligen qué prueba queda al final de cada parte. Sin opciones, todas: sin GPU de verdad y luego las
 * emuladas.
 */
export type OrdenDelFondo = { equipos?: readonly (typeof EQUIPOS)[number][0][]; escenarios?: readonly string[]; deVerdad?: boolean };

/**
 * Las pruebas del fondo animado en las densidades que se piden: sin GPU de verdad y con el equipo emulado (sin GPU y con GPU
 * rápida). Las reparten brillo-del-fondo, optica-retina y velocidad-del-fondo (*.spec.ts): en el CI, el WebGL por
 * software del navegador remoto hace que las de GPU emulada tarden de 34 a 132 s cada una, y el reparto de la e2e las deja al
 * final de partes distintas.
 */
export function pruebasDelFondo(dprs: readonly number[], orden: OrdenDelFondo = {}) {
  const escenarios = orden.escenarios ? orden.escenarios.map((nombre) => ESCENARIOS.find((escenario) => escenario.nombre === nombre)!) : ESCENARIOS;
  const sinGpuDeVerdad = () => {
    // Chromium headless pinta WebGL con la CPU, como una máquina virtual, un escritorio remoto o una laptop sin aceleración.
    // A 1440×900 y DPR 1 cada dibujo cuesta unos 47 ms y su cuadro pasa de 50 con el pintado; a DPR 2, cientos de ms.
    for (const dpr of dprs) {
      test.describe(`fondo animado en un navegador sin GPU a DPR ${dpr}`, () => {
        test.use({ deviceScaleFactor: dpr, viewport: { width: 1440, height: 900 } });

        test("tras la primera pintura, a lo más un cuadro largo: el fondo se queda quieto y lo recuerda al recargar", async ({ page }) => {
          await page.addInitScript(() => {
            const registro = window as unknown as { cuadrosLargos: unknown[]; primeraPintura?: number };
            registro.cuadrosLargos = [];
            new PerformanceObserver((lista) => registro.cuadrosLargos.push(...lista.getEntries())).observe({ type: "long-animation-frame", buffered: true });
            new MutationObserver(() => {
              if (registro.primeraPintura === undefined && document.querySelector("canvas.escena-lienzo[data-cuadros]")) registro.primeraPintura = performance.now();
            }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-cuadros"] });
          });
          await entrar(page);
          await page.goto(INICIO);
          const lienzo = page.locator("canvas.escena-lienzo");
          await expect(lienzo).toHaveAttribute("data-cuadros", /\d/, { timeout: 60_000 });
          // Hasta que el fondo decide quedarse quieto o pinta tres cuadros más; luego dos segundos por si sigue.
          await expect
            .poll(async () => (await lienzo.getAttribute("data-estado")) === "lento" || Number(await lienzo.getAttribute("data-cuadros")) >= 4, { timeout: 60_000 })
            .toBe(true);
          await page.waitForTimeout(2000);
          const primeraCarga = await cuadrosLargosDelFondo(page);
          expect(primeraCarga.archivos, "el archivo del fondo se encontró").toBeGreaterThan(0);
          expect(primeraCarga.cuadros, "cuadros largos del fondo después de su primera pintura").toBeLessThanOrEqual(1);
          await expect(lienzo).toHaveAttribute("data-estado", "lento");

          // En la siguiente carga completa ya no vuelve a medir: pinta una vez, quieto.
          await page.reload();
          await expect(lienzo).toHaveAttribute("data-cuadros", /\d/, { timeout: 60_000 });
          await page.waitForTimeout(2000);
          await expect(lienzo).toHaveAttribute("data-estado", "lento");
          await expect(lienzo).toHaveAttribute("data-cuadros", "1");
          expect((await cuadrosLargosDelFondo(page)).cuadros, "cuadros largos del fondo al recargar").toBe(0);
        });
      });
    }
  };

  const emulado = () => {
    // La regla del fondo en cada combinación: sin GPU se queda quieto en la segunda pintura, lo recuerda y repinta una sola
    // vez cuando el tamaño deja de cambiar; con GPU sigue vivo y no recuerda nada.
    for (const [equipo, conGpu] of EQUIPOS.filter(([nombre]) => !orden.equipos || orden.equipos.includes(nombre))) {
      for (const dpr of dprs) {
        test.describe(`fondo animado ${equipo} (emulado) a DPR ${dpr}`, () => {
          test.use({ deviceScaleFactor: dpr, viewport: { width: 1440, height: 900 } });
          for (const escenario of escenarios) {
            test(escenario.nombre, async ({ page: paginaDelWorker, playwright, baseURL, viewport, deviceScaleFactor, launchOptions }) => {
              // Con el lienzo emulado de 48 px, cada una tarda de 2 a 5 s (en el CI, con WebGL por software, también: el costo es el
              // emulado). Si la emulación se cae y el fondo pinta a pantalla completa, o algo no llega, que falle pronto y diga
              // qué esperaba, no a los 180 s de la e2e: 60 s por prueba y 20 s por espera.
              test.setTimeout(60_000);
              // Con GPU emulada, un navegador propio que se cierra al terminar: el proceso de GPU es de todo el navegador y,
              // con WebGL por software, sigue trabajando después de cerrar el contexto (2.4 s de CPU en los 5 s siguientes, medido
              // con SwiftShader). Cerrar el navegador lo termina, y la prueba que sigue en el worker no hereda esa carga.
              const propio = conGpu ? await navegadorPropio(playwright, launchOptions) : null;
              try {
                const page = propio ? await (await propio.newContext({ baseURL, viewport, deviceScaleFactor })).newPage() : paginaDelWorker;
                // Sin GPU, un dibujo cuesta unos 47 ms a DPR 1 y cientos de ms a DPR 2: aquí, con cuadros largos seguros.
                await emularEquipo(page, { dibujoMs: conGpu ? 0 : dpr === 1 ? 60 : 150, crecerMs: escenario.crecerMs ?? 0 });
                await entrar(page);
                await page.goto(INICIO);
                const lienzo = page.locator("canvas.escena-lienzo");
                const pinturas = async () => Number(await lienzo.getAttribute("data-cuadros"));
                const recordado = () => page.evaluate(() => sessionStorage.getItem("lever-fondo-lento"));
                await expect(lienzo, "el fondo pinta con WebGL").toHaveAttribute("data-gpu", "si", { timeout: 20_000 });
                // La emulación tiene que estar puesta: si la hoja no se aplicó (la CSP, por ejemplo), el lienzo no mide 48 px y la
                // prueba mediría otra cosa sin decirlo.
                expect(await lienzo.evaluate((nodo) => [nodo.clientWidth, nodo.clientHeight]), "el lienzo emulado mide 48 px").toEqual([48, 48]);
                await escenario.hacer(page);
                const largos = await cuadrosLargosDelFondo(page);
                // Para leer un fallo: estado, pinturas, ms promedio por dibujo y si la decisión se guardó (solo la del dibujo).
                const como = JSON.stringify(await lienzo.evaluate((nodo: HTMLCanvasElement) => ({ ...nodo.dataset, guardado: sessionStorage.getItem("lever-fondo-lento") })));
                if (conGpu) {
                  await expect(lienzo, `sigue vivo: ${como}`).toHaveAttribute("data-estado", "vivo", { timeout: 1 });
                  expect(largos.cuadros, `cuadros largos del fondo: ${como} · ${largos.detalle}`).toBeLessThanOrEqual(escenario.conGpuLargos ?? 0);
                  expect(await recordado(), "no recuerda nada").toBeNull();
                  // Y en la siguiente carga vuelve a animar.
                  await page.reload();
                  await expect.poll(pinturas, { message: "al recargar, pinta al menos 3 veces", timeout: 20_000 }).toBeGreaterThanOrEqual(3);
                  await expect(lienzo, "al recargar, vivo").toHaveAttribute("data-estado", "vivo");
                } else {
                  await expect(lienzo, "quieto").toHaveAttribute("data-estado", "lento");
                  expect(largos.cuadros, `cuadros largos del fondo después de su primera pintura: ${largos.detalle}`).toBeLessThanOrEqual(escenario.sinGpu.largos);
                  expect(await pinturas(), "pinturas").toBeLessThanOrEqual(escenario.sinGpu.pinturas);
                  expect(await recordado(), "lo recuerda").toBe("1");
                }
              } finally {
                await propio?.close();
              }
            });
          }
        });
      }
    }
  };

  if (orden.deVerdad ?? (!orden.equipos || orden.equipos.includes("sin GPU"))) sinGpuDeVerdad();
  emulado();
}
