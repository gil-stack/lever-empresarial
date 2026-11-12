# Sabotajes de producto de -10 (aplicar.py) sobre las 3 specs del fondo (23 pruebas)
# Antes: 7ae84dc (salidas de -10 en sondas-66-7ae84dc/sab/). Después: con las guardas de r66-N5 (este commit).

| Sabotaje | Antes (7ae84dc) | Después | Mensaje |
|---|---|---|---|
| S1 reasignar el búfer en cada dibujo | 23 ✓ · 0 ✘ | 3 ✓ · 20 ✘ | asignaciones a width/height con el mismo valor: {"repetidas":{"escena":2,"motor":2},"maximo":{"esce |
| S2 dibujar a DPR completo | 23 ✓ · 0 ✘ | 3 ✓ · 20 ✘ | búfer de dibujo de la escena: 48 px × min(DPR 2, 2) × 0.85 = 82 |
| S4 el motor pinta 1440×900×DPR | 23 ✓ · 0 ✘ | 3 ✓ · 20 ✘ | el búfer del motor no pasa del lienzo más grande de la escena: {"escena":[82,82],"motor":[2880,1800 |
| P2a sin GPU, sin los dos frenos | 10 ✓ · 13 ✘ | 10 ✓ · 13 ✘ | quieto |
| P2b sin GPU, sin el corte por dibujo | 10 ✓ · 13 ✘ | 10 ✓ · 13 ✘ | cuadros largos del fondo después de su primera pintura: 78 ms (fondo 60, estilo, layout y pintado 0 |
| sin sabotaje | 23 ✓ | 23 ✓ · 0 ✘ | |

Las 3 que siguen en verde con S1, S2 y S4 no usan la emulación: las dos «en un navegador sin GPU» de verdad y la de 40 ms.

# r66-N6: el mismo P2b antes y después del cambio de «pintado» (desde renderStart → desde styleAndLayoutStart)
antes:   Error: cuadros largos del fondo después de su primera pintura: 75 ms (fondo 60, pintado 60); 77 ms (fondo 60, pintado 60); 76 ms (fondo 60, pintado 60); 61 ms (fondo 60, pin
después: Error: cuadros largos del fondo después de su primera pintura: 75 ms (fondo 60, estilo, layout y pintado 0); 76 ms (fondo 60, estilo, layout y pintado 0); 75 ms (fondo 60, estilo, layout y pintado 0); 62 ms (fondo
