import { test } from "@playwright/test";

import { pruebasDelFondo } from "./fondo-pruebas";

// rueda-del-fondo.spec.ts (entre roles y runway): dos de GPU a DPR 2 en la parte 8, antes de runway.
// Las pruebas se definen en fondo-pruebas.ts y se reparten en 4 archivos (animacion-del-fondo, lienzo-del-fondo, optica-retina y
// rueda-del-fondo), cuyo nombre los deja en distintos lugares del orden alfabético. El reparto de la e2e corta por número de
// pruebas, en orden, y las pruebas con GPU emulada tardan en el CI de 34 a 132 s cada una (WebGL por software): el acomodo sale
// del simulador del reparto con el tiempo máximo observado de cada prueba, comprobado con `playwright test --list --shard=N/8`
// (tests/e2e/LEEME.md), y prefiere, sin exigirlo, dejarlas al final de su parte (cada una abre y cierra su propio navegador). Si
// cambia el número de pruebas antes de estos archivos, los cortes se mueven y hay que volver a acomodarlas. Cada prueba entra
// con su propia cookie y no comparte estado: «parallel» solo para que el reparto pueda partir el archivo (con workers: 1 corren
// una tras otra).
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["una tarea ajena de 800 ms"] });
pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["arrastrar la ventana"] });
