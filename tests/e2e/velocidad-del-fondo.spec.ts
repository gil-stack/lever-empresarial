import { test } from "@playwright/test";

import { pruebasDelFondo } from "./fondo-pruebas";

// velocidad-del-fondo.spec.ts (después de tarjetas, el último archivo): dos de GPU cierran la parte 8, la última.
// Las pruebas se definen en fondo-pruebas.ts y se reparten en 4 archivos (abanico-del-fondo, animacion-del-fondo, rueda-del-
// fondo y velocidad-del-fondo), cuyo nombre los deja en distintos lugares del orden alfabético. El reparto de la e2e corta por
// número de pruebas, en orden, y las pruebas con GPU emulada tardan en el CI de 34 a 162 s cada una (WebGL por software): el
// acomodo sale del simulador del reparto con el tiempo máximo observado de cada prueba, comprobado con `playwright test --list
// --shard=N/8` (tests/e2e/LEEME.md), y deja cada una al final de su parte, sin pruebas normales después (cada una abre y cierra
// su propio navegador). Si cambia el número de pruebas antes de estos archivos, los cortes se mueven y hay que volver a
// acomodarlas. Cada prueba entra con su propia cookie y no comparte estado: «parallel» solo para que el reparto pueda partir el
// archivo (con workers: 1 corren una tras otra).
test.describe.configure({ mode: "parallel" });

pruebasDelFondo([1], { equipos: ["con GPU rápida"], escenarios: ["el búfer del motor crece una vez"] });
pruebasDelFondo([2], { equipos: ["con GPU rápida"], escenarios: ["estable"] });
