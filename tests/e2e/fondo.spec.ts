import { expect, test } from "@playwright/test";

import { pruebasDelFondo } from "./fondo-pruebas";
import { INICIO, entrar } from "./marco-apoyo";

// El fondo animado (antes en marco.spec.ts): todo DPR 1 y dos de las cinco con GPU emulada a DPR 2; las otras de DPR 2 van en
// optica-retina.spec.ts. Las de GPU a DPR 2 tardan de 66 a 114 s cada una en el CI (WebGL por software en el navegador
// remoto) y el reparto de la e2e corta por número de pruebas, en orden: «una tarea ajena» va primero (cae en la parte 3) y
// «el búfer» al final (en la 4), para no juntarlas. Detalle y modelo en tests/e2e/LEEME.md. Cada prueba entra con su propia
// cookie y no comparte estado: «parallel» solo para que el reparto pueda partir el archivo (con workers: 1 corren una tras otra).
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["una tarea ajena de 800 ms"] });
pruebasDelFondo([1]);

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

pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["el búfer del motor crece una vez"] });
