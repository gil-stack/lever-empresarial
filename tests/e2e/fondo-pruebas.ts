import { expect, test, type Browser, type LaunchOptions, type Page, type PlaywrightWorkerArgs } from "@playwright/test";

import { INICIO, entrar } from "./marco-apoyo";

/** Lo que este archivo necesita de un Long Animation Frame (el DOM de TypeScript aún no lo trae). */
interface CuadroLargo {
  startTime: number;
  duration: number;
  renderStart: number;
  styleAndLayoutStart: number;
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
 * fue del fondo y cuánto de estilo, layout y pintado, para leer una falla.
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
      // r66-N6: desde styleAndLayoutStart (estilo, layout y pintado). renderStart incluye los callbacks de rAF, y el fondo
      // dibuja en uno de ellos: medido desde ahí, el «pintado» repetía el ms del fondo.
      .map(({ cuadro, fondoMs }) => `${Math.round(cuadro.duration)} ms (fondo ${Math.round(fondoMs)}, estilo, layout y pintado ${cuadro.styleAndLayoutStart ? Math.round(cuadro.startTime + cuadro.duration - cuadro.styleAndLayoutStart) : "?"})`)
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
async function emularEquipo(page: Page, costo: { dibujoMs: number; crecerMs: number; sinWebGl?: boolean }) {
  await page.addInitScript((op) => {
    const registro = window as unknown as { cuadrosLargos: unknown[]; primeraPintura?: number };
    registro.cuadrosLargos = [];
    new PerformanceObserver((lista) => registro.cuadrosLargos.push(...lista.getEntries())).observe({ type: "long-animation-frame", buffered: true });
    new MutationObserver(() => {
      if (registro.primeraPintura === undefined && document.querySelector("canvas.escena-lienzo[data-cuadros]")) registro.primeraPintura = performance.now();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-cuadros"] });
    // r66-N5: lo que se pinta de verdad. La emulación cambia la copia por una espera y fija el lienzo en 48 px, así que una
    // regresión que agranda lo que se pinta (o lo reasigna en cada dibujo) no costaría nada aquí: se vigilan los tamaños.
    // Cada asignación a width o height de un canvas: su máximo y cuántas veces repitió el valor que ya tenía (asignar
    // borra el canvas y, en WebGL, reasigna el búfer de dibujo aunque el tamaño no cambie).
    // r66-N11: también OffscreenCanvas, que puede ser el búfer del motor (un refactor legítimo) o uno que nunca se copia.
    type Lienzo = HTMLCanvasElement | OffscreenCanvas;
    const maximoAsignado = new WeakMap<Lienzo, [number, number]>();
    const repetidas = new WeakMap<Lienzo, number>();
    // r66-N7: todas las asignaciones desde que el tamaño quedó fijado (la prueba reinicia el conteo después del poll).
    let asignaciones = new WeakMap<Lienzo, number>();
    (window as unknown as { reiniciarAsignaciones: () => void }).reiniciarAsignaciones = () => {
      asignaciones = new WeakMap();
    };
    // r66-N9: todo canvas que pide un contexto, WebGL o 2D, aunque nunca se copie a la escena: un búfer que se pinta y no
    // se ve también cuesta (en la GPU o, sin WebGL, en la CPU). Se vigilan los que no cuelgan del documento, que son los
    // búferes, y (r66-N10) los colgados dentro de `.escena-fondo` salvo la escena, como una capa encima; la escena se compara
    // aparte y una gráfica de la página (colgada fuera del fondo) no es del fondo. Medido en INICIO: solo la escena (2D, en el
    // DOM) y el búfer del motor (webgl2, suelto) piden contexto. Se descartó seguir la pila de getContext hasta el archivo del
    // fondo: el búfer del motor nace en otro chunk y depende del formato y del largo de la pila.
    const conContexto = new Set<Lienzo>();
    for (const proto of [HTMLCanvasElement.prototype, OffscreenCanvas.prototype]) {
      const pedirContexto = proto.getContext as (...a: unknown[]) => unknown;
      (proto as { getContext: unknown }).getContext = function (this: Lienzo, tipo: string, ...resto: unknown[]) {
        // Un equipo sin WebGL2: el motor pinta su degradado 2D.
        if (op.sinWebGl && (tipo === "webgl" || tipo === "webgl2")) return null;
        conContexto.add(this);
        return pedirContexto.call(this, tipo, ...resto);
      };
    }
    let buferDelMotor: Lienzo | null = null;
    [HTMLCanvasElement.prototype, OffscreenCanvas.prototype].forEach((proto) => (["width", "height"] as const).forEach((lado, i) => {
      const propio = Object.getOwnPropertyDescriptor(proto, lado)!;
      Object.defineProperty(proto, lado, {
        ...propio,
        set(this: Lienzo, valor: number) {
          // r66-N8: se compara después de la coerción (41.25 queda en 41): el canvas reasigna su búfer igual.
          const antes = propio.get!.call(this) as number;
          propio.set!.call(this, valor);
          if (propio.get!.call(this) === antes) repetidas.set(this, (repetidas.get(this) ?? 0) + 1);
          asignaciones.set(this, (asignaciones.get(this) ?? 0) + 1);
          const maximo = maximoAsignado.get(this) ?? [0, 0];
          maximo[i] = Math.max(maximo[i]!, propio.get!.call(this) as number);
          maximoAsignado.set(this, maximo);
        },
      });
    }));
    (window as unknown as { tamanosDelFondo: () => unknown }).tamanosDelFondo = () => {
      const escena = document.querySelector<HTMLCanvasElement>("canvas.escena-lienzo");
      return {
        repetidas: { escena: escena ? (repetidas.get(escena) ?? 0) : -1, motor: buferDelMotor ? (repetidas.get(buferDelMotor) ?? 0) : -1 },
        asignaciones: { escena: escena ? (asignaciones.get(escena) ?? 0) : -1, motor: buferDelMotor ? (asignaciones.get(buferDelMotor) ?? 0) : -1 },
        buferes: [...conContexto]
          .filter((canvas) => canvas !== escena && (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected || canvas.closest(".escena-fondo") !== null))
          .map((canvas) => [canvas.width, canvas.height]),
        maximo: { escena: escena ? (maximoAsignado.get(escena) ?? [0, 0]) : [], motor: buferDelMotor ? [buferDelMotor.width, buferDelMotor.height] : [] },
      };
    };
    const copiar = CanvasRenderingContext2D.prototype.drawImage;
    const maximos = new WeakMap<object, [number, number]>();
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...argumentos: unknown[]) {
      if (this.canvas.classList.contains("escena-lienzo")) {
        const bufer = argumentos[0] as Lienzo;
        buferDelMotor = bufer;
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

/**
 * La emulación está puesta y el tamaño quedó fijado. Si la hoja no se aplicó (la CSP, por ejemplo), el lienzo no mide
 * 48 px y la prueba mediría otra cosa sin decirlo. r66-N5: el búfer de dibujo de la escena es el de 48 px de CSS ×
 * min(DPR, 2) × 0.85 (DPR_MAXIMO y ESCALA de fondo-escena.tsx, que no se exportan): 41 a DPR 1 y 82 a DPR 2; dibujar a DPR
 * completo o a pantalla completa lo cambia. Con espera acotada: el primer dibujo puede ser anterior a que la hoja llegue y
 * el siguiente lo corrige. Desde aquí se cuentan las asignaciones a width y height (r66-N7).
 */
async function fijarTamano(page: Page, dpr: number) {
  const lienzo = page.locator("canvas.escena-lienzo");
  expect(await lienzo.evaluate((nodo) => [nodo.clientWidth, nodo.clientHeight]), "el lienzo emulado mide 48 px").toEqual([48, 48]);
  const buferEsperado = Math.round(48 * Math.min(dpr, 2) * 0.85);
  await expect
    .poll(() => lienzo.evaluate((nodo: HTMLCanvasElement) => [nodo.width, nodo.height]), {
      message: `búfer de dibujo de la escena: 48 px × min(DPR ${dpr}, 2) × 0.85 = ${buferEsperado}`,
      timeout: 5_000,
    })
    .toEqual([buferEsperado, buferEsperado]);
  await page.evaluate(() => (window as unknown as { reiniciarAsignaciones: () => void }).reiniciarAsignaciones());
}

/**
 * Lo que se pinta no crece ni se reasigna sin necesidad:
 * - r66-N5/N8: ninguna asignación a width o height deja el valor que ya tenía (reasignar borra el búfer y lo vuelve a pedir);
 * - r66-N5: el búfer del motor no pasa del lienzo más grande que tuvo la escena;
 * - r66-N9/N10/N11: ningún otro búfer (canvas u OffscreenCanvas con contexto, WebGL o 2D, suelto o dentro de
 *   `.escena-fondo`) pasa de ese lienzo;
 * - r66-N7: si el escenario no cambia el tamaño, nada vuelve a asignar width ni height una vez fijado (reasignar con otro
 *   valor en cada dibujo también reasigna el búfer, y «mismo valor» no lo ve).
 * Sin WebGL no hay búfer del motor: se vigila solo la escena.
 */
async function vigilarTamanos(page: Page, { cambiaElTamano, conMotor }: { cambiaElTamano: boolean; conMotor: boolean }) {
  const tamanos = (await page.evaluate(() => (window as unknown as { tamanosDelFondo: () => unknown }).tamanosDelFondo())) as {
    repetidas: { escena: number; motor: number };
    asignaciones: { escena: number; motor: number };
    buferes: number[][];
    maximo: { escena: number[]; motor: number[] };
  };
  const quien = <T>(valor: { escena: T; motor: T }) => (conMotor ? valor : { escena: valor.escena });
  const ninguno = quien({ escena: 0, motor: 0 });
  const dentro = (medidas: number[]) => medidas.every((medida, i) => medida <= (tamanos.maximo.escena[i] ?? 0));
  expect(quien(tamanos.repetidas), `asignaciones a width/height que dejan el mismo valor: ${JSON.stringify(tamanos)}`).toEqual(ninguno);
  if (conMotor) expect(dentro(tamanos.maximo.motor), `el búfer del motor no pasa del lienzo más grande de la escena: ${JSON.stringify(tamanos.maximo)}`).toBe(true);
  expect(
    tamanos.buferes.every(dentro),
    `ningún búfer (canvas u OffscreenCanvas con contexto suelto, o dentro de .escena-fondo) pasa del lienzo más grande de la escena: ${JSON.stringify({ buferes: tamanos.buferes, escena: tamanos.maximo.escena })}`,
  ).toBe(true);
  if (!cambiaElTamano) {
    expect(quien(tamanos.asignaciones), `asignaciones a width/height con el tamaño ya fijado: ${JSON.stringify(tamanos)}`).toEqual(ninguno);
  }
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
  /** El escenario cambia el tamaño del lienzo: ahí sí se reasigna (r66-N7 solo vigila los que no lo cambian). */
  cambiaElTamano?: boolean;
}

const ESCENARIOS: Escenario[] = [
  { nombre: "estable", hacer: async (page) => page.waitForTimeout(2500), sinGpu: { largos: 1, pinturas: 2 } },
  {
    // Lo que tapaba la excepción de tamaño: cada dibujo con otro tamaño, sin que crezca el búfer.
    nombre: "el lienzo cambia de tamaño en cada cuadro",
    cambiaElTamano: true,
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
    cambiaElTamano: true,
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
    cambiaElTamano: true,
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
 * rápida). Las reparten abanico-del-fondo, fondo, optica-retina y velocidad-del-fondo (*.spec.ts): en el CI, el WebGL por
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
                await fijarTamano(page, dpr);
                await escenario.hacer(page);
                await vigilarTamanos(page, { cambiaElTamano: escenario.cambiaElTamano ?? false, conMotor: true });
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

/**
 * r66-N9: un equipo sin WebGL2, en una página nueva, a DPR `dpr` (1 y, desde r66-N10, 2). El motor pinta su degradado 2D en el lienzo de la escena; ningún otro
 * canvas (un respaldo por CPU a pantalla completa que luego se escala, por ejemplo) pasa de él, y nada se reasigna con el
 * tamaño ya fijado. Va dentro de una prueba que ya existe (la de 40 ms, en velocidad-del-fondo.spec.ts): una prueba más movería los cortes
 * del reparto de la e2e y dejaría pruebas normales después de una con GPU emulada.
 */
export async function comprobarSinWebGl(page: Page, dpr: number) {
  await emularEquipo(page, { dibujoMs: 0, crecerMs: 0, sinWebGl: true });
  await page.goto(INICIO);
  const lienzo = page.locator("canvas.escena-lienzo");
  await expect(lienzo, "sin WebGL2, el fondo pinta en 2D").toHaveAttribute("data-gpu", "no", { timeout: 20_000 });
  await fijarTamano(page, dpr);
  // Lo que hace el producto en ese camino (fondo-escena.tsx no lo trata aparte): el degradado 2D cuesta poco, se mide como
  // cualquier dibujo y el fondo sigue animando, sin quedarse quieto ni recordar «lento».
  const pinturas = async () => Number(await lienzo.getAttribute("data-cuadros"));
  const antes = await pinturas();
  await page.waitForTimeout(2500);
  expect(await pinturas(), "sin WebGL2 sigue animando").toBeGreaterThan(antes);
  await expect(lienzo, "sin WebGL2, vivo").toHaveAttribute("data-estado", "vivo");
  expect(await page.evaluate(() => sessionStorage.getItem("lever-fondo-lento")), "sin WebGL2 no recuerda «lento»").toBeNull();
  await vigilarTamanos(page, { cambiaElTamano: false, conMotor: false });
}
