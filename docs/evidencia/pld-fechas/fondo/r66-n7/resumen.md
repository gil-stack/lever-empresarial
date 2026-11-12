# Sabotajes de producto sobre las 3 specs del fondo (23 pruebas): c9d9e8b contra este commit (r66-N7, N8 y N9)
# aplicar.py: el de -10 (sondas-66-c9d9e8b/sab/) más S9 y C2D de este commit. «Antes»: salidas de -10 sobre c9d9e8b.

| Sabotaje | Antes (c9d9e8b) | Después | Mensaje más frecuente |
|---|---|---|---|
| sin sabotaje | 23 ✓ · 0 ✘ | 23 ✓ · 0 ✘ |  |
| S1 reasignar el búfer en cada dibujo | 3 ✓ · 20 ✘ | 2 ✓ · 21 ✘ | asignaciones a width/height que dejan el mismo valor: {"repetidas":{"escena":2,"motor":2},"asignaciones":{"es |
| S2 dibujar a DPR completo | 3 ✓ · 20 ✘ | 2 ✓ · 21 ✘ | búfer de dibujo de la escena: 48 px × min(DPR 1, 2) × 0.85 = 41 |
| S4 el motor pinta 1440×900×DPR | 3 ✓ · 20 ✘ | 3 ✓ · 20 ✘ | el búfer del motor no pasa del lienzo más grande de la escena: {"escena":[82,82],"motor":[2880,1800]} |
| S5 la escena reasigna con otro valor en cada dibujo | 13 ✓ · 10 ✘ | 7 ✓ · 16 ✘ | búfer de dibujo de la escena: 48 px × min(DPR 2, 2) × 0.85 = 82 |
| S5m el motor reasigna alternando +1 px | 9 ✓ · 14 ✘ | 9 ✓ · 14 ✘ | el búfer del motor no pasa del lienzo más grande de la escena: {"escena":[41,41],"motor":[42,42]} |
| S6 el motor pinta la ventana × 0.85 × DPR | 3 ✓ · 20 ✘ | 3 ✓ · 20 ✘ | el búfer del motor no pasa del lienzo más grande de la escena: {"escena":[82,82],"motor":[2448,1530]} |
| S7 la escena reasigna ancho + 0.25 (el canvas lo trunca) | 23 ✓ · 0 ✘ | 2 ✓ · 21 ✘ | asignaciones a width/height que dejan el mismo valor: {"repetidas":{"escena":2,"motor":0},"asignaciones":{"es |
| S8 el motor limpia un WebGL2 de pantalla×DPR que no se copia | 23 ✓ · 0 ✘ | 3 ✓ · 20 ✘ | ningún búfer (canvas con contexto fuera del documento) pasa del lienzo más grande de la escena: {"buferes":[[ |
| S9 sin WebGL: un 2D oculto de pantalla×DPR que se escala | 23 ✓ · 0 ✘ | 22 ✓ · 1 ✘ | ningún búfer (canvas con contexto fuera del documento) pasa del lienzo más grande de la escena: {"buferes":[[ |
| control: una gráfica 2D de 600×300 colgada de la página | — | 23 ✓ · 0 ✘ |  |
| P2a sin GPU, sin los dos frenos | 10 ✓ · 13 ✘ | 10 ✓ · 13 ✘ | quieto |
| P2b sin GPU, sin el corte por dibujo | 10 ✓ · 13 ✘ | 10 ✓ · 13 ✘ | cuadros largos del fondo después de su primera pintura: 78 ms (fondo 60, estilo, layout y pintado 0); 78 ms ( |

- S9 solo puede caer en la prueba que recorre el camino sin WebGL2: la de 40 ms de brillo-del-fondo.spec.ts, que ahora
  también abre INICIO con getContext("webgl2") en null (comprobarSinWebGl). Las otras 22 pintan con WebGL.
- C2D es el control: una gráfica 2D colgada del documento no cuenta como búfer del fondo y la base sigue en verde.
