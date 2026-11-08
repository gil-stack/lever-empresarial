import { expect, test, type Page } from "@playwright/test";

const EMPRESA = "33333333-3333-4333-8333-333333333333";
const INICIO = `/c/${EMPRESA}/consola`;
const GIL = "a".repeat(43);
const ORIGEN = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PUERTO ?? "3109"}`;

async function entrar(page: Page, token = GIL) {
  await page.context().clearCookies();
  // `next start` corre en producción: la cookie de sesión lleva el prefijo __Host- (Secure, Path=/, sin Domain).
  await page.context().addCookies([
    { name: "__Host-sesion", value: token, domain: new URL(ORIGEN).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
  ]);
}

test.describe("marco de la consola en escritorio", () => {
  test("menú de la persona: cuatro opciones fuera del Tab; Tab y Escape cierran y regresan el foco al botón", async ({ page }) => {
    await entrar(page);
    await page.goto(INICIO);
    const boton = page.locator(".cuenta .menu-desplegable-boton");
    await boton.click();
    const opciones = page.locator(".cuenta [role=menuitem]");
    await expect(opciones).toHaveText([/Mi perfil y seguridad/, /Apariencia/, /Salir/]);
    await expect(opciones.first()).toBeFocused();
    expect(await opciones.evaluateAll((todas) => todas.map((o) => o.getAttribute("tabindex")))).toEqual(["-1", "-1", "-1"]);
    await page.keyboard.press("ArrowDown");
    await expect(opciones.nth(1)).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(boton).toHaveAttribute("aria-expanded", "false");
    await expect(boton).toBeFocused();

    await boton.click();
    await page.keyboard.press("Escape");
    await expect(boton).toHaveAttribute("aria-expanded", "false");
    await expect(boton).toBeFocused();

    await boton.click();
    await opciones.filter({ hasText: "Apariencia" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${EMPRESA}/consola/apariencia$`));
  });

  test("el buscador de la barra lleva a su sección con lo escrito", async ({ page }) => {
    await entrar(page);
    await page.goto(INICIO);
    const busqueda = page.getByRole("search").getByRole("searchbox");
    await busqueda.fill("Rosa");
    await busqueda.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/c/${EMPRESA}/consola/(personas|proveedores)\\?.*q=Rosa`));
  });

  test("Apariencia: con sesión y empresa se abre; sin sesión manda a entrar; otra empresa no la muestra", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${INICIO}/apariencia`);
    await expect(page).toHaveURL(/\/entrar/);

    await entrar(page);
    const respuesta = await page.goto(`${INICIO}/apariencia`);
    expect(respuesta?.status()).toBe(200);
    await expect(page.locator(".apariencia")).toBeVisible();
    await expect(page.locator(".temas").getByRole("button", { name: "Oscuro", exact: true })).toBeVisible();

    await page.goto("/c/00000000-0000-4000-8000-000000000000/consola/apariencia");
    await expect(page.locator(".apariencia")).toHaveCount(0);
  });
});

/** Lo que este archivo necesita de un Long Animation Frame (el DOM de TypeScript aún no lo trae). */
interface CuadroLargo {
  startTime: number;
  scripts: { sourceURL: string }[];
}

/** Los cuadros de más de 50 ms (los que registra Long Animation Frames) con un script del fondo, después de su primera pintura. */
async function cuadrosLargosDelFondo(page: Page): Promise<{ archivos: number; cuadros: number }> {
  return page.evaluate(async () => {
    const registro = window as unknown as { cuadrosLargos: CuadroLargo[]; primeraPintura?: number };
    // El archivo del bucle del fondo es el que trae su aviso de error.
    const delFondo = new Set<string>();
    for (const recurso of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
      if (recurso.initiatorType !== "script") continue;
      if ((await (await fetch(recurso.name)).text()).includes("No se pudo cargar el fondo animado")) delFondo.add(recurso.name);
    }
    const primera = registro.primeraPintura ?? Infinity;
    const cuadros = registro.cuadrosLargos.filter(
      (cuadro) => cuadro.startTime > primera && cuadro.scripts.some((script) => delFondo.has(script.sourceURL)),
    ).length;
    return { archivos: delFondo.size, cuadros };
  });
}

// Chromium headless pinta WebGL con la CPU, como una máquina virtual, un escritorio remoto o una laptop sin aceleración.
// A 1440×900 y DPR 1 cada dibujo cuesta unos 47 ms y su cuadro pasa de 50 con el pintado; a DPR 2, cientos de ms.
for (const dpr of [1, 2]) {
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

test.describe("fondo animado en un equipo que pinta cada cuadro en 40 ms", () => {
  test("se queda quieto en la segunda pintura, sin esperar la ventana de 80 cuadros", async ({ page }) => {
    // Un equipo que pinta lento pero sin pasar de 50 ms por dibujo, igual en cualquier máquina: el lienzo se encoge para
    // que pintarlo no cueste nada y cada copia de la escena al lienzo tarda 40 ms.
    await page.addInitScript(() => {
      const copiar = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...argumentos: unknown[]) {
        if (this.canvas.classList.contains("escena-lienzo")) {
          const fin = performance.now() + 40;
          while (performance.now() < fin);
        }
        return (copiar as (...a: unknown[]) => void).apply(this, argumentos);
      } as typeof copiar;
      document.addEventListener("DOMContentLoaded", () => {
        const estilo = document.createElement("style");
        estilo.textContent = ".escena-lienzo { width: 8px !important; height: 8px !important; }";
        document.head.append(estilo);
      });
    });
    await entrar(page);
    await page.goto(INICIO);
    const lienzo = page.locator("canvas.escena-lienzo");
    await expect(lienzo, "el fondo pinta con WebGL").toHaveAttribute("data-gpu", "si", { timeout: 60_000 });
    await expect
      .poll(async () => (await lienzo.getAttribute("data-estado")) === "lento" || Number(await lienzo.getAttribute("data-cuadros")) >= 4, { timeout: 60_000 })
      .toBe(true);
    await expect(lienzo, "pinturas hasta quedarse quieto").toHaveAttribute("data-cuadros", "2");
    await expect(lienzo).toHaveAttribute("data-estado", "lento");
  });

  test("en un equipo rápido, el dibujo que cambia de tamaño no lo deja quieto aunque tarde", async ({ page }) => {
    // Con GPU, crecer la ventana a 2560×1600 a DPR 2 tomó 30 ms en el dibujo que reserva otra vez el lienzo. Aquí el lienzo
    // mide 1 % de la ventana, así que pintarlo no cuesta nada, y solo el dibujo que cambia de tamaño tarda 60 ms.
    await page.addInitScript(() => {
      const copiar = CanvasRenderingContext2D.prototype.drawImage;
      const anchos = new WeakMap<HTMLCanvasElement, number>();
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...argumentos: unknown[]) {
        if (this.canvas.classList.contains("escena-lienzo")) {
          const antes = anchos.get(this.canvas);
          anchos.set(this.canvas, this.canvas.width);
          if (antes !== undefined && antes !== this.canvas.width) {
            const fin = performance.now() + 60;
            while (performance.now() < fin);
          }
        }
        return (copiar as (...a: unknown[]) => void).apply(this, argumentos);
      } as typeof copiar;
      document.addEventListener("DOMContentLoaded", () => {
        const estilo = document.createElement("style");
        estilo.textContent = ".escena-lienzo { width: 1vw !important; height: 1vh !important; }";
        document.head.append(estilo);
      });
    });
    await entrar(page);
    await page.goto(INICIO);
    const lienzo = page.locator("canvas.escena-lienzo");
    const pinturas = async () => Number(await lienzo.getAttribute("data-cuadros"));
    await expect.poll(pinturas, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    const ancho = await lienzo.evaluate((nodo: HTMLCanvasElement) => nodo.width);
    const antes = await pinturas();
    await page.setViewportSize({ width: 2560, height: 1600 });
    // El dibujo con el tamaño nuevo y uno más, o que se quede quieto: la decisión ya se habría tomado.
    await expect
      .poll(async () => (await pinturas()) >= antes + 2 || (await lienzo.getAttribute("data-estado")) === "lento", { timeout: 30_000 })
      .toBe(true);
    expect(await lienzo.evaluate((nodo: HTMLCanvasElement) => nodo.width), "el lienzo cambió de tamaño").toBeGreaterThan(ancho);
    await expect(lienzo, "sigue vivo después de cambiar de tamaño").toHaveAttribute("data-estado", "vivo");
  });
});

test.describe("cajón móvil", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("sin checkVisibility (Safari < 17.4): abre, atrapa el foco, deja el fondo inert; Escape y el velo regresan el foco", async ({ page }) => {
    const errores: string[] = [];
    page.on("pageerror", (error) => errores.push(error.message));
    await page.addInitScript(() => {
      delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility;
    });
    await entrar(page);
    await page.goto(INICIO);
    const secciones = page.getByRole("button", { name: "Secciones" });
    const cajon = page.locator("#lateral");

    await secciones.click();
    await expect(cajon).toHaveAttribute("data-abierto", "si");
    await expect(page.locator(".lienzo")).toHaveAttribute("inert", "");
    for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.querySelector("#lateral")?.contains(document.activeElement) || document.activeElement?.classList.contains("boton-menu")))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(cajon).toHaveAttribute("data-abierto", "no");
    await expect(page.getByRole("button", { name: "Secciones" })).toBeFocused();
    await expect(page.locator(".lienzo")).not.toHaveAttribute("inert", "");

    await secciones.click();
    await expect(cajon).toHaveAttribute("data-abierto", "si");
    await page.locator(".velo").click({ position: { x: 370, y: 400 } });
    await expect(cajon).toHaveAttribute("data-abierto", "no");
    await expect(page.getByRole("button", { name: "Secciones" })).toBeFocused();

    await expect(page.locator(".pie-movil")).toHaveText("El saldo vive con el participante de la CLABE. El plástico vive con el emisor.");
    expect(errores).toEqual([]);
  });
});
