import { test } from "@playwright/test";

import { pruebasDelFondo } from "./fondo-pruebas";

// El fondo animado a DPR 2 (pantallas Retina), aparte de fondo.spec.ts. En el CI, cada prueba con GPU emulada a DPR 2 tarda de
// 66 a 114 s (WebGL por software en el navegador remoto). El reparto de la e2e corta por número de pruebas, en orden de
// archivo: el nombre deja este archivo justo después de operacion.spec.ts, donde cruza el corte entre las partes 6 y 7, y
// el orden de abajo pone tres de GPU (114, 78 y 66 s) y tres cortas en la parte 6, y el resto en la 7 (unos 335 s de
// pruebas en la más cargada, con los tiempos del CI de 88278c4). Cada prueba entra con su propia cookie y no comparte
// estado: «parallel» solo para que el reparto pueda partir el archivo.
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["el lienzo cambia de tamaño en cada cuadro", "arrastrar la ventana", "el búfer del motor crece una vez"] });
pruebasDelFondo([2], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["el búfer del motor crece una vez", "arrastrar la ventana", "estable", "el lienzo cambia de tamaño en cada cuadro", "una tarea ajena de 800 ms"] });
pruebasDelFondo([2], { equipos: [], deVerdad: true });
pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["una tarea ajena de 800 ms", "estable"] });
