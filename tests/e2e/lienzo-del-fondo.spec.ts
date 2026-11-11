import { test } from "@playwright/test";

import { pruebasDelFondo } from "./fondo-pruebas";

// lienzo-del-fondo.spec.ts (después de invitacion): la de GPU a DPR 2 «el búfer» entre las cortas, en la parte 4.
// Las pruebas se definen en fondo-pruebas.ts y se reparten en 4 archivos (animacion-del-fondo, lienzo-del-fondo, optica-retina y
// rueda-del-fondo), cuyo nombre los deja en distintos lugares del orden alfabético. El reparto de la e2e corta por número de
// pruebas, en orden, y las pruebas con GPU emulada tardan en el CI de 34 a 132 s cada una (WebGL por software): el acomodo sale
// del simulador del reparto con el tiempo máximo observado de cada prueba, comprobado con `playwright test --list --shard=N/8`
// (tests/e2e/LEEME.md), y prefiere, sin exigirlo, dejarlas al final de su parte (cada una abre y cierra su propio navegador). Si
// cambia el número de pruebas antes de estos archivos, los cortes se mueven y hay que volver a acomodarlas. Cada prueba entra
// con su propia cookie y no comparte estado: «parallel» solo para que el reparto pueda partir el archivo (con workers: 1 corren
// una tras otra).
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([2], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["estable"] });
pruebasDelFondo([2], { equipos: [], deVerdad: true });
pruebasDelFondo([1], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["el búfer del motor crece una vez"] });
pruebasDelFondo([1], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["el lienzo cambia de tamaño en cada cuadro"] });
pruebasDelFondo([1], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["arrastrar la ventana"] });
pruebasDelFondo([2], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["una tarea ajena de 800 ms"] });
pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["el búfer del motor crece una vez"] });
pruebasDelFondo([1], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["una tarea ajena de 800 ms"] });
pruebasDelFondo([2], { equipos: ["sin GPU"], deVerdad: false, escenarios: ["el búfer del motor crece una vez"] });
pruebasDelFondo([1], { equipos: [], deVerdad: true });
