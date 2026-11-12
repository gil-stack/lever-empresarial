# Evidencia del #66: pruebas que fallaban por el reloj o por el entorno

La regla de producción no cambia en ningún punto: no hay migración y no se toca `src/` fuera de un `*.test.ts`.

## Medianoche de México (primera a tercera vuelta)

| Archivo | Qué muestra |
|---|---|
| `matriz-reloj-fijo.txt` | `pld-postgres` con libfaketime en Postgres y Node, en 12 horas de México: en main, de 8 a 9 rojas de 00:00 a 01:00; con el arreglo, 28/28 |
| `prueba-de-medianoche-rojo-verde.txt` | `minutosAtrasDeHoy` con reloj fijo: falla 5 de 12 con la fórmula de main y pasa 12/12 con el arreglo |
| `b5-min-del-campo.txt` | Sin JavaScript, el navegador no envía un `datetime-local` por debajo de su `min` (B5 de `pld.spec`) |
| `e2e-today-contraprueba.txt` | `E2E_TODAY` de ayer y del domingo: nómina en rojo con main y 18/18 con el arreglo |
| `cruce-de-medianoche-r66-n1.txt` | La suite que arranca a las 23:59:57: 23/28 en aa6accf y 28/28 con la espera |
| `espera-y-segundo-factor-r66-n3.txt` | La espera con el factor fechado al cargar: 26/28 en 46d5e6d; con el getter y 2 min, 28/28 en 5 horas × 2 husos |
| `inventario-bombas-de-fecha.txt` | Cada «hoy», «hace N minutos», `T00:00`, `E2E_TODAY`, fecha UTC y fecha al cargar un módulo en `tests/`, `src/`, `db/` y `scripts/`, con su veredicto |

## Fondo animado (cuarta a sexta vuelta), en `fondo/`

| Archivo | Qué muestra |
|---|---|
| `estres-arrastrar.txt` | «arrastrar la ventana» con carga y la CPU frenada por CDP, N=30: HEAD falla 1/30 (×16) y 23/30 (×24); el arreglo, 0 y 0. Y qué cuadro sale largo |
| `swiftshader-tarea-ajena.txt` | Con WebGL por software y carga: la vieja tarda de 23 a 36 s por prueba (en el CI, más de 180); la nueva pasa 60/60 |
| `sabotaje.txt` | Sabotajes de JS en `fondo-escena.tsx` (cuarta vuelta): un cuadro de 60 ms del fondo hace caer a la nueva 10/10 |
| `r66-n5/resumen.md` | Sabotajes de -10 que agrandan o reasignan lo que se pinta (S1, S2, S4): de 23 ✓ a 20 ✘, cada uno con su mensaje; P2a y P2b siguen en rojo; r66-N6 antes y después |
| `r66-n5/estres-familia.txt` | Las 23 pruebas del fondo × 30 vueltas con carga |
| `r66-n7/resumen.md` | Sabotajes S1, S2, S4, S5, S5m, S6, S7, S8 y S9, el control con una gráfica 2D en la página y P2a/P2b, contra c9d9e8b y con r66-N7, N8 y N9 |
| `r66-n7/estres-familia.txt` | Las 23 pruebas del fondo × 30 vueltas con carga, con las guardas de r66-N7, N8 y N9 |
| `r66-n10/resumen.md` | Sabotajes S1 a S11, S5m, OFF+S1m y S2d, los controles C2D y C2Dg, el refactor OFF y P2a/P2b, contra 858db5c y con r66-N10, N11 y DPR 2 sin WebGL2 |
| `r66-n10/estres-familia.txt` | Las 23 pruebas del fondo × 30 vueltas con carga, con las guardas de r66-N10 y N11 |
| `fechas-al-cargar.cjs.txt` | Detector por AST de fechas evaluadas al cargar un módulo (r66-N4) |
| `diagnostico-fondo.spec.ts.txt`, `*.sh.txt` y `*.py.txt` | Las sondas y los parches temporales con que se midió (no se suben como código) |

### Qué vigila ahora la familia del fondo (`tests/e2e/fondo-pruebas.ts`)

- **La emulación está puesta.** La hoja lleva el nonce de la CSP, y el lienzo mide 48 px de CSS (8 px en la prueba de 40 ms). Si no, falla en menos de 1 s.
- **Lo que se pinta.** El búfer de dibujo de la escena es 48 × min(DPR, 2) × 0.85 (41 o 82).
  - El búfer del motor no pasa del lienzo más grande que tuvo la escena.
  - **r66-N9:** ningún otro canvas con contexto (WebGL o 2D) que no cuelgue del documento pasa de él. Se eligió vigilar los canvas sueltos y no seguir la pila: el búfer del motor nace en otro chunk, y una gráfica de la página cuelga del DOM y queda fuera.
  - **r66-N10:** tampoco los canvas con contexto colgados dentro de `.escena-fondo`, salvo la escena (una capa encima, por ejemplo). Una gráfica colgada fuera del fondo sigue sin contar.
  - **r66-N11:** lo mismo con `OffscreenCanvas`: `getContext`, `width` y `height` se interceptan también en su prototipo, así que pasar el búfer del motor a `OffscreenCanvas` sigue en verde y las guardas lo siguen vigilando.
  - Ninguna asignación a `width` o `height` deja el valor que ya tenía. **r66-N8:** se compara después de la coerción.
  - **r66-N7:** en «estable» y «tarea ajena», nada vuelve a asignar `width` ni `height` una vez fijado el tamaño.
  - Todo se vigila con el setter y `getContext` interceptados en `HTMLCanvasElement` y en `OffscreenCanvas`. Hoy el búfer del motor es un canvas (`motor.ts:250`).
- **Sin WebGL2** (r66-N9, dentro de la prueba de 40 ms, para no mover el reparto): `getContext("webgl2")` da `null`, en `HTMLCanvasElement` y en `OffscreenCanvas`. Se comprueba a DPR 1 y (r66-N10) a DPR 2, en un contexto nuevo con la sesión copiada.
  - El fondo pinta en 2D (`data-gpu="no"`), sigue animando y vivo, y no recuerda «lento», que es lo que hace el producto en ese camino.
  - Aplican las mismas guardas de tamaño.
- **El tiempo del fondo mismo.** Un cuadro largo cuenta contra el fondo solo si sus scripts pasan de 25 ms (`DIBUJO_BLOQUEANTE_MS`). El detalle de la falla da, de cada cuadro, cuánto fue del fondo y cuánto de estilo, layout y pintado (desde `styleAndLayoutStart`).
- **Las reglas de producción.** Con GPU, el fondo sigue vivo; sin GPU, se queda quieto, lo recuerda y repinta lo justo.
