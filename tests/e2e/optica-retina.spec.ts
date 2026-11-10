import { test } from "@playwright/test";

import { pruebasDelFondo } from "./fondo-pruebas";

// El fondo animado a DPR 2 (pantallas Retina): sin GPU de verdad, las cinco sin GPU emulada y tres de las cinco con GPU
// emulada; las otras dos de GPU van en fondo.spec.ts. En el CI cada una con GPU a DPR 2 tarda de 66 a 114 s (WebGL por
// software en el navegador remoto). El reparto de la e2e corta por número de pruebas, en orden de archivo: el nombre deja
// este archivo justo después de operacion.spec.ts, donde cruza el corte entre las partes 6 y 7, y este orden pone una de GPU
// en la 6 y las otras dos en la 7. Si cambia el número de pruebas antes de este archivo, el corte se mueve: revisa el
// reparto con el modelo (tests/e2e/LEEME.md). Cada prueba entra con su propia cookie y no comparte estado: «parallel» solo
// para que el reparto pueda partir el archivo.
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["el lienzo cambia de tamaño en cada cuadro"] });
pruebasDelFondo([2], { equipos: [], deVerdad: true });
pruebasDelFondo([2], { equipos: ["sin GPU"], deVerdad: false });
pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["estable", "arrastrar la ventana"] });
