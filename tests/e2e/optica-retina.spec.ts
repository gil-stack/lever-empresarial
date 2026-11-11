import { test } from "@playwright/test";

import { pruebasDelFondo } from "./fondo-pruebas";

// optica-retina.spec.ts (después de operacion): dos de GPU a DPR 2 cierran la parte 6; las cuatro sin GPU que siguen ya caen en la 7.
// Las pruebas se definen en fondo-pruebas.ts y se reparten en tres archivos (brillo-del-fondo, optica-retina y
// velocidad-del-fondo), cuyo nombre los deja en distintos lugares del orden alfabético. El reparto de la e2e corta por número de
// pruebas, en orden, y este orden deja cada prueba con GPU emulada (en el CI, de 34 a 132 s cada una con WebGL por software) al
// final de su parte, con ninguna otra después en la misma máquina. El acomodo sale del simulador del reparto con el tiempo máximo
// observado de cada prueba, comprobado con `playwright test --list --shard=N/8` (tests/e2e/LEEME.md): si cambia el número de
// pruebas antes de estos archivos, los cortes se mueven y hay que volver a acomodarlas. Cada prueba entra con su propia cookie y
// no comparte estado: «parallel» solo para que el reparto pueda partir el archivo (con workers: 1 corren una tras otra).
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([2], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["el búfer del motor crece una vez"] });
pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["el búfer del motor crece una vez"] });
pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["una tarea ajena de 800 ms"] });
pruebasDelFondo([1], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["arrastrar la ventana"] });
pruebasDelFondo([2], { equipos: [], deVerdad: true });
pruebasDelFondo([2], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["el lienzo cambia de tamaño en cada cuadro"] });
pruebasDelFondo([1], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["una tarea ajena de 800 ms"] });
