import { expect, test } from "@playwright/test";

import { comprobarSinWebGl, pruebasDelFondo } from "./fondo-pruebas";
import { INICIO, entrar } from "./marco-apoyo";

// animacion-del-fondo.spec.ts (después de accesibilidad): dos de GPU cierran la parte 1 y las otras dos abren la 2.
// Las pruebas se definen en fondo-pruebas.ts y se reparten en 4 archivos (animacion-del-fondo, lienzo-del-fondo, optica-retina y
// rueda-del-fondo), cuyo nombre los deja en distintos lugares del orden alfabético. El reparto de la e2e corta por número de
// pruebas, en orden, y las pruebas con GPU emulada tardan en el CI de 34 a 132 s cada una (WebGL por software): el acomodo sale
// del simulador del reparto con el tiempo máximo observado de cada prueba, comprobado con `playwright test --list --shard=N/8`
// (tests/e2e/LEEME.md), y prefiere, sin exigirlo, dejarlas al final de su parte (cada una abre y cierra su propio navegador). Si
// cambia el número de pruebas antes de estos archivos, los cortes se mueven y hay que volver a acomodarlas. Cada prueba entra
// con su propia cookie y no comparte estado: «parallel» solo para que el reparto pueda partir el archivo (con workers: 1 corren
// una tras otra).
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["estable"] });
pruebasDelFondo([1], { equipos: ["con GPU rápida"], escenarios: ["una tarea ajena de 800 ms"] });

test.describe("fondo animado en un equipo que pinta cada cuadro en 40 ms", () => {
  test("se queda quieto en la segunda pintura, sin esperar la ventana de 80 cuadros", async ({ page, browser, baseURL, viewport }) => {
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
        // La hoja lleva el nonce de la página: sin él, la CSP estricta no la aplica y el lienzo queda a pantalla completa.
        estilo.nonce = document.querySelector<HTMLElement>("[nonce]")?.nonce ?? "";
        document.head.append(estilo);
      });
    });
    await entrar(page);
    await page.goto(INICIO);
    const lienzo = page.locator("canvas.escena-lienzo");
    await expect(lienzo, "el fondo pinta con WebGL").toHaveAttribute("data-gpu", "si", { timeout: 60_000 });
    expect(await lienzo.evaluate((nodo) => [nodo.clientWidth, nodo.clientHeight]), "el lienzo emulado mide 8 px").toEqual([8, 8]);
    await expect
      .poll(async () => (await lienzo.getAttribute("data-estado")) === "lento" || Number(await lienzo.getAttribute("data-cuadros")) >= 4, { timeout: 60_000 })
      .toBe(true);
    await expect(lienzo, "pinturas hasta quedarse quieto").toHaveAttribute("data-cuadros", "2");
    await expect(lienzo).toHaveAttribute("data-estado", "lento");

    // r66-N9: y un equipo sin WebGL2 (degradado 2D) no pinta búferes más grandes que la escena ni los reasigna. En una página
    // nueva de este contexto (con la sesión y sin la emulación de 40 ms) para no sumar una prueba al reparto.
    await comprobarSinWebGl(await page.context().newPage(), 1);
    // r66-N10: lo mismo a DPR 2, en un contexto nuevo con la sesión copiada (el DPR es del contexto).
    const aDpr2 = await browser.newContext({ baseURL, viewport, deviceScaleFactor: 2, storageState: await page.context().storageState() });
    try {
      await comprobarSinWebGl(await aDpr2.newPage(), 2);
    } finally {
      await aDpr2.close();
    }
  });
});

pruebasDelFondo([1], { equipos: ["con GPU rápida"], escenarios: ["arrastrar la ventana"] });
