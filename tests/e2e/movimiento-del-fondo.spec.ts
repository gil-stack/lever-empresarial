import { expect, test } from "@playwright/test";

import { pruebasDelFondo } from "./fondo-pruebas";
import { INICIO, entrar } from "./marco-apoyo";

// movimiento-del-fondo.spec.ts (entre marco y nomina): cortas, la de 40 ms y tres de GPU que cierran la parte 4.
// Las pruebas se definen en fondo-pruebas.ts y se reparten en cuatro archivos (fondo, movimiento-del-fondo, optica-retina y
// velocidad-del-fondo), cuyo nombre los deja en distintos lugares del orden alfabético. El reparto de la e2e corta por número de
// pruebas, en orden, y este orden deja cada prueba con GPU emulada (en el CI, de 34 a 132 s cada una con WebGL por software) al
// final de su parte, con ninguna otra después en la misma máquina. El acomodo sale del simulador del reparto con el tiempo máximo
// observado de cada prueba (tests/e2e/LEEME.md): si cambia el número de pruebas antes de estos archivos, los cortes se mueven y
// hay que volver a acomodarlas. Cada prueba entra con su propia cookie y no comparte estado: «parallel» solo para que el reparto
// pueda partir el archivo (con workers: 1 corren una tras otra).
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([1], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["el búfer del motor crece una vez"] });
pruebasDelFondo([2], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["estable", "una tarea ajena de 800 ms", "el búfer del motor crece una vez"] });
pruebasDelFondo([1], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["estable"] });

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
});

pruebasDelFondo([1], { equipos: ["con GPU rápida"], escenarios: ["el lienzo cambia de tamaño en cada cuadro"] });
pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["el lienzo cambia de tamaño en cada cuadro"] });
pruebasDelFondo([1], { equipos: ["con GPU rápida"], escenarios: ["arrastrar la ventana"] });
pruebasDelFondo([2], { equipos: [], deVerdad: true });
