# Sabotajes sobre las 3 specs del fondo (23 pruebas): 858db5c contra este commit (r66-N10, N11 y DPR 2 sin WebGL2)
# aplicar.py.txt: el de la ronda anterior más S10, S11, OFF y S1m de -10 (sondas-66-858db5c/sab/aplicar.py), C2Dg y S2d.
# «Antes»: S1 a S9, P2a y P2b, la columna «después» de r66-n7/resumen.md (858db5c); los marcados (-10), salidas de -10 sobre
# 858db5c; S2d, corrido aquí con las pruebas de 858db5c (antes-S2d.txt).

| Sabotaje | Antes (858db5c) | Después | Mensaje más frecuente |
|---|---|---|---|
| sin sabotaje | 23 ✓ · 0 ✘ | 23 ✓ · 0 ✘ |  |
| control C2D: gráfica 2D de 600×300 colgada de la página | 23 ✓ · 0 ✘ | 23 ✓ · 0 ✘ |  |
| control C2Dg (de -10): gráfica 2D de 1440×900 colgada del body | 23 ✓ · 0 ✘ (-10) | 23 ✓ · 0 ✘ |  |
| OFF: el búfer del motor pasa a OffscreenCanvas (refactor legítimo) | 22 ✓ · 1 ✘ (-10; ✘ falso: «sin WebGL2, el fondo pinta en 2D») | 23 ✓ · 0 ✘ |  |
| S1 reasignar el búfer en cada dibujo | 2 ✓ · 21 ✘ | 2 ✓ · 21 ✘ | asignaciones a width/height que dejan el mismo valor: {"repetidas":{"escena":2,"motor":2},"asignaciones":{"esc |
| S2 dibujar a DPR completo | 2 ✓ · 21 ✘ | 2 ✓ · 21 ✘ | búfer de dibujo de la escena: 48 px × min(DPR 1, 2) × 0.85 = 41 |
| S4 el motor pinta 1440×900×DPR | 3 ✓ · 20 ✘ | 3 ✓ · 20 ✘ | el búfer del motor no pasa del lienzo más grande de la escena: {"escena":[41,41],"motor":[1440,900]} |
| S5 la escena reasigna con otro valor en cada dibujo | 7 ✓ · 16 ✘ | 7 ✓ · 16 ✘ | búfer de dibujo de la escena: 48 px × min(DPR 1, 2) × 0.85 = 41 |
| S5m el motor reasigna alternando +1 px | 9 ✓ · 14 ✘ | 9 ✓ · 14 ✘ | al recargar, pinta al menos 3 veces |
| S6 el motor pinta la ventana × 0.85 × DPR | 3 ✓ · 20 ✘ | 3 ✓ · 20 ✘ | el búfer del motor no pasa del lienzo más grande de la escena: {"escena":[41,41],"motor":[1224,765]} |
| S7 la escena reasigna ancho + 0.25 | 2 ✓ · 21 ✘ | 2 ✓ · 21 ✘ | asignaciones a width/height que dejan el mismo valor: {"repetidas":{"escena":2,"motor":0},"asignaciones":{"esc |
| S8 el motor limpia un WebGL2 de pantalla×DPR que no se copia | 3 ✓ · 20 ✘ | 3 ✓ · 20 ✘ | ningún búfer (canvas u OffscreenCanvas con contexto suelto, o dentro de .escena-fondo) pasa del lienzo más gra |
| S9 sin WebGL: un 2D oculto de pantalla×DPR que se escala | 22 ✓ · 1 ✘ | 22 ✓ · 1 ✘ | ningún búfer (canvas u OffscreenCanvas con contexto suelto, o dentro de .escena-fondo) pasa del lienzo más gra |
| S10 capa de grano: 2D de pantalla×min(DPR,2) colgado de .escena-fondo | 23 ✓ · 0 ✘ (-10) | 2 ✓ · 21 ✘ | ningún búfer (canvas u OffscreenCanvas con contexto suelto, o dentro de .escena-fondo) pasa del lienzo más gra |
| S11 OffscreenCanvas WebGL2 de pantalla×DPR que no se copia | 23 ✓ · 0 ✘ (-10) | 3 ✓ · 20 ✘ | ningún búfer (canvas u OffscreenCanvas con contexto suelto, o dentro de .escena-fondo) pasa del lienzo más gra |
| OFF+S1m: motor en OffscreenCanvas que reasigna en cada dibujo | 22 ✓ · 1 ✘ (-10; solo el ✘ falso de OFF) | 3 ✓ · 20 ✘ | asignaciones a width/height que dejan el mismo valor: {"repetidas":{"escena":0,"motor":2},"asignaciones":{"esc |
| S2d: S2 solo en el camino 2D y a DPR ≥ 2 | 23 ✓ · 0 ✘ | 22 ✓ · 1 ✘ | búfer de dibujo de la escena: 48 px × min(DPR 2, 2) × 0.85 = 82 |
| P2a sin GPU, sin los dos frenos | 10 ✓ · 13 ✘ | 10 ✓ · 13 ✘ | quieto |
| P2b sin GPU, sin el corte por dibujo | 10 ✓ · 13 ✘ | 10 ✓ · 13 ✘ | cuadros largos del fondo después de su primera pintura: 75 ms (fondo 60, estilo, layout y pintado 0); 77 ms (f |

- S10 cae en las 21 pruebas emuladas: la capa cuelga de `.escena-fondo` y ahora cuenta como búfer; las dos de «sin GPU de verdad»
  no instalan la vigilancia. C2D y C2Dg cuelgan fuera del fondo y siguen en verde.
- OFF queda en 23 ✓: `getContext` (con el mismo `null` para webgl y webgl2 en el camino sin WebGL2), `width` y `height` se
  interceptan también en `OffscreenCanvas.prototype`, así que el ✘ falso desaparece y el motor se sigue vigilando: OFF+S1m
  cae por «mismo valor» (repetidas motor 4) y S11 por el búfer de 2880×1800.
- S2d solo cambia el camino 2D a DPR 2: con 858db5c pasa 23/23 porque la comprobación sin WebGL2 solo corría a DPR 1; ahora
  la prueba de 40 ms también la corre a DPR 2, en un contexto nuevo con `deviceScaleFactor: 2` y la sesión copiada, y cae
  por el búfer de la escena (96 en vez de 82). S9 sigue cayendo solo ahí, la única prueba que recorre ese camino.
- Costo local de la prueba de 40 ms: de 3.3 a 6.2 s (la comprobación a DPR 2 suma una carga de INICIO y 2.5 s de espera).
- El reparto no cambia: `playwright test --list --shard=i/8` da las mismas pruebas que 858db5c en las 8 partes (25, 19, 26,
  22, 24, 20, 33 y 10).
- Estrés (estres-familia.txt): las 23 pruebas × 30 vueltas con 10 bucles de CPU en 18 núcleos, 690 de 690 en 45 min. La de
  40 ms tarda de 6.3 a 9.7 s; la más lenta, una «el búfer del motor crece una vez» con GPU emulada a DPR 2, 22 s (las demás,
  menos de 11 s), lejos de los 60 s por prueba.
